"""The planner.

The party is two parents and one child, and they can stand in two queues at
once. That is modelled as two tracks running down the same clock:

* **Track 0 -- the family track.** A parent plus the child. Everything this
  track rides counts as a ride the child got to do, which is what the day is
  actually for.
* **Track 1 -- the free parent.** The other parent, unattached. They can ride
  a height-restricted coaster alone, take the single-rider line, book a
  Premier Access return window on the phone, hold a standby place for the
  family to join, or simply tag along on the family's next ride.

Search is an event-driven beam search: repeatedly advance whichever track is
free earliest, enumerate that track's legal moves, score them, and keep the
best few hundred partial days. States at different clock times are compared
using a value-rate estimate of what the remaining hours are worth, so a state
that has banked more value by spending more of the day is not automatically
preferred over one that is running ahead of schedule.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Iterable, Protocol

from .config import CHILD, EVERYONE, FAMILY, PARENT_B, TripConfig, _hhmm
from .model import Attraction, Catalog, Plan, PlanItem
from .walk import WalkMatrix

#: Value bonus for the first time the child does something on the must-do list.
MUST_DO_BONUS = 22.0
#: How many candidate attractions each track considers per decision. Keeps the
#: branching factor sane without meaningfully hurting plan quality.
CANDIDATES_PER_TRACK = 11
#: Minutes the free parent spends on the phone booking Premier Access.
PA_BOOKING_MIN = 3
#: Slack minutes required between finishing a ride and park close.
CLOSING_SLACK = 5
#: A child re-riding a favourite is normal; doing it twice within the same
#: couple of hours is the planner running out of ideas. Block repeats inside
#: this window so late-day filler spreads across attractions instead.
REPEAT_COOLDOWN_MIN = 150


class WaitOracle(Protocol):
    """What the planner needs to know about queues. Both the live forecaster
    and the backtest's perfect-hindsight oracle implement this."""

    def expected_queue_min(self, ride_id: str, arrive_minute: int) -> float: ...
    def single_rider_wait(self, ride_id: str, at_minute: int) -> float | None: ...
    def premier_return(self, ride_id: str, book_minute: int) -> tuple[int, float] | None: ...
    def availability(self, ride_id: str, at_minute: int) -> float: ...


@dataclass(frozen=True)
class Commitment:
    """A ride one track is currently occupied with."""
    ride_id: str
    board: int
    end: int
    group: int


@dataclass(frozen=True)
class State:
    t0: int                       # family track free-at (minutes since midnight)
    t1: int                       # free-parent track free-at
    loc0: str
    loc1: str
    child_done: frozenset         # ride ids the child has done
    child_count: int              # total child rides incl. repeats
    adult_done: frozenset         # ride ids a parent has done solo
    pa_holds: tuple               # ((ride_id, return_minute, wait), ...)
    pa_used: int
    cur0: Commitment | None       # family's in-progress ride, for SHADOW
    lunch_done: bool
    value: float
    items: tuple                  # tuple[PlanItem, ...]
    #: ((ride_id, finished_at), ...) for the family track, pruned to the
    #: repeat-cooldown window. Small enough to scan on every expansion.
    recent0: tuple = ()
    #: Minutes the child has spent walking so far, and metres covered. Legs
    #: get more expensive as these climb.
    walked0_min: int = 0
    walked0_m: int = 0

    def key(self) -> tuple:
        return (
            self.t0 // 5, self.t1 // 5, self.loc0, self.loc1,
            self.child_done, self.child_count, self.adult_done,
            self.pa_used, self.lunch_done,
            tuple(sorted(h[0] for h in self.pa_holds)),
        )

    def on_cooldown(self, ride_id: str, now: int) -> bool:
        return any(r == ride_id and now - t < REPEAT_COOLDOWN_MIN
                   for r, t in self.recent0)

    def push_recent(self, ride_id: str, end: int) -> tuple:
        kept = tuple((r, t) for r, t in self.recent0
                     if end - t < REPEAT_COOLDOWN_MIN)
        return kept + ((ride_id, end),)


class Optimizer:
    def __init__(self, catalog: Catalog, cfg: TripConfig, oracle: WaitOracle,
                 walk: WalkMatrix | None = None):
        self.cat = catalog
        self.cfg = cfg
        self.oracle = oracle
        self.walk = walk or WalkMatrix(catalog, cfg.party.walk_speed_family_mps,
                                       cfg.party.walk_speed_adult_mps)
        self.day_end = cfg.day_end()
        self.lunch_from = _hhmm(cfg.lunch_window[0])
        self.lunch_to = _hhmm(cfg.lunch_window[1])
        self.lunch_len = cfg.lunch_window[2]
        self._appeal = {a.id: float(cfg.appeal_overrides.get(a.id, a.appeal)) for a in catalog}
        self._child_ok = {
            a.id: a.admits(cfg.party.child_height_cm) for a in catalog
        }
        self._rate_hat = self._estimate_value_rate()

    # ---- value model --------------------------------------------------------

    def _estimate_value_rate(self) -> float:
        """Rough value-per-minute a good plan sustains. Used to compare states
        sitting at different points in the day, so the beam is not biased
        toward whichever branch has burned the most clock."""
        s = self.cfg.strategy
        best = sorted(
            (a for a in self.cat if self._child_ok[a.id]),
            key=lambda a: -self._appeal[a.id],
        )[:12]
        if not best:
            return 0.05
        total_value = sum(self._appeal[a.id] * s.child_value_weight for a in best)
        total_time = sum(a.duration_min + 0.55 * a.typical_peak_wait + 7 for a in best)
        return total_value / max(1.0, total_time)

    def _solo_worthwhile(self, a: Attraction) -> bool:
        """Is this something a parent would actually go and ride on their own?

        Without this the planner cheerfully sends a grown adult to queue
        thirty-five minutes for Dumbo by himself. A parent splits off for a
        proper thrill ride, or for something the child is too small to join --
        not to collect kiddie attractions. A minimum height of 81cm marks a
        gentle family ride; 100cm and up is the real stuff.
        """
        return ((a.min_height_cm or 0) >= 100
                or (a.type in {"coaster", "drop", "simulator"} and a.appeal >= 6)
                or a.appeal >= 9)

    def _walk_cost(self, walked_so_far: int, leg_min: int) -> float:
        """What this leg costs, charging tired minutes at a steeper rate.

        The first stretch of walking is free-ish; once the child is past their
        stamina budget every further minute on foot is expensive, because that
        is when a plan stops being followed.
        """
        s = self.cfg.strategy
        stamina = self.cfg.party.child_stamina_min
        over = max(0, walked_so_far + leg_min - stamina) - max(0, walked_so_far - stamina)
        return s.walk_penalty_per_min * leg_min + s.tired_child_penalty_per_min * over

    def _ride_value(self, a: Attraction, group: int, repeats: int) -> float:
        s = self.cfg.strategy
        base = self._appeal[a.id]
        if group & CHILD:
            weight = s.child_value_weight
            if group & PARENT_B:
                # Whole family together: nothing is running in parallel, so it
                # only pays when the ride itself is worth the lost slot.
                weight *= 1.05
        else:
            weight = s.adult_solo_value_weight
            if not self._solo_worthwhile(a):
                # Exactly zero, not merely small: with any positive value the
                # walk and queue penalties still leave splitting up marginally
                # ahead of waiting, and the parent ends up alone on Dumbo.
                # At zero those penalties make it strictly worse than idling.
                return 0.0
        return base * weight * (s.repeat_decay ** repeats)

    # ---- candidate generation ----------------------------------------------

    def _candidates(self, state: State, track: int) -> list[Attraction]:
        """The most promising attractions for this track, right now."""
        now = state.t0 if track == 0 else state.t1
        loc = state.loc0 if track == 0 else state.loc1
        with_child = track == 0
        out = []
        for a in self.cat:
            if a.id in self.cfg.skip:
                continue
            if track == 0:
                if state.on_cooldown(a.id, now):
                    continue
                if not self._child_ok[a.id]:
                    # Only worth considering as a Rider Switch, and only while
                    # both parents are actually together.
                    if not (self.cfg.strategy.allow_rider_switch
                            and a.id not in state.adult_done
                            and state.t1 <= now + 5):
                        continue
                repeats = 1 if a.id in state.child_done else 0
                group = FAMILY
            else:
                # The free parent never repeats: while anything is still
                # unridden, a second lap is the worst use of a parallel queue.
                if a.id in state.adult_done:
                    continue
                # Nor do they re-ride what the family already covered, unless
                # it is something the child could not join them on.
                if self._child_ok[a.id] and a.id in state.child_done:
                    continue
                repeats = 0
                group = PARENT_B
            walk = self.walk.minutes(loc, a.id, with_child)
            arrive = now + walk
            if arrive + a.duration_min > self.cfg.close_minute(a.park) - CLOSING_SLACK:
                continue
            q = self.oracle.expected_queue_min(a.id, int(arrive))
            value = self._ride_value(a, group, repeats)
            if track == 0:
                value += MUST_DO_BONUS if (
                    a.id in self.cfg.must_do and a.id not in state.child_done) else 0.0
                value -= self._walk_cost(state.walked0_min, int(walk))
            if track == 1 and self.cfg.strategy.allow_standby_hold:
                # A ride the parent would never bother with alone can still be
                # the best thing to go and hold a place in.
                if self._child_ok[a.id] and a.id not in state.child_done:
                    hold_value = self._ride_value(a, EVERYONE, 0)
                    if a.id in self.cfg.must_do:
                        hold_value += MUST_DO_BONUS
                    value = max(value, hold_value)
            cost = walk + q + a.duration_min
            out.append((value / max(4.0, cost), a))
        out.sort(key=lambda x: -x[0])
        return [a for _, a in out[:CANDIDATES_PER_TRACK]]

    # ---- transitions --------------------------------------------------------

    def _expand(self, state: State) -> list[State]:
        # Advance whichever track is free first; ties go to the family, whose
        # commitment the free parent may then choose to shadow.
        track = 0 if state.t0 <= state.t1 else 1
        if track == 0:
            return self._expand_family(state)
        return self._expand_free_parent(state)

    # -- family track ---------------------------------------------------------

    def _expand_family(self, state: State) -> list[State]:
        out: list[State] = []
        t = state.t0

        # Lunch is compulsory and must land inside its window. Once the window
        # has opened, a ride is only allowed if it still leaves room to eat;
        # otherwise eating is the sole legal move. Without this the planner
        # starts a ninety-minute queue at 13:10 and the window quietly passes.
        must_eat_now = False
        if not state.lunch_done and t >= self.lunch_from:
            out.append(self._do_meal(state))
            must_eat_now = t >= self.lunch_to - self.lunch_len
            if must_eat_now:
                return out

        deadline = None if state.lunch_done else self.lunch_to - self.lunch_len
        for a in self._candidates(state, track=0):
            out.extend(self._family_ride_options(state, a, deadline))

        if not out:
            nxt = min(self.day_end, t + 15)
            if nxt > t:
                out.append(replace(state, t0=nxt))
        return out

    def _family_ride_options(self, state: State, a: Attraction,
                             deadline: int | None) -> Iterable[State]:
        t = state.t0
        walk = self.walk.int_minutes(state.loc0, a.id, with_child=True)
        arrive = max(t + walk, self.cfg.open_minute(a.park))
        repeats = 1 if a.id in state.child_done else 0
        close = self.cfg.close_minute(a.park) - CLOSING_SLACK

        def ok(end: int) -> bool:
            # Never overrun park close, and never straddle the lunch window.
            return end <= close and (deadline is None or end <= deadline)

        if not self._child_ok[a.id]:
            # The child is too short. Both parents can still ride via Rider
            # Switch: one queues, they swap at the front, the child never
            # queues twice.
            if self.cfg.strategy.allow_rider_switch and state.t1 <= arrive:
                q = self.oracle.expected_queue_min(a.id, arrive)
                board = int(arrive + q)
                end = board + 2 * a.duration_min
                if ok(end):
                    yield self._commit_rider_switch(state, a, walk, arrive, board, end, int(q))
            return

        # -- redeem a Premier Access window we already hold
        for rid, ret_min, pa_wait in state.pa_holds:
            if rid != a.id:
                continue
            board = int(max(arrive, ret_min) + pa_wait)
            end = board + a.duration_min
            if ok(end):
                yield self._commit_family(
                    state, a, walk, arrive, board, end, "premier", int(pa_wait), repeats,
                    pa_holds=tuple(h for h in state.pa_holds if h[0] != a.id))

        # -- ordinary standby
        q = self.oracle.expected_queue_min(a.id, arrive)
        board = int(arrive + q)
        end = board + a.duration_min
        if ok(end):
            yield self._commit_family(state, a, walk, arrive, board, end,
                                      "standby", int(q), repeats)

    def _commit_family(self, state: State, a: Attraction, walk: int, arrive: int,
                       board: int, end: int, mode: str, wait: int, repeats: int,
                       pa_holds: tuple | None = None) -> State:
        """Parent A and the child commit to a ride.

        The free parent is deliberately *not* dragged along here. Leaving them
        unscheduled is what creates the second queue: on their own turn they
        decide whether tagging along is worth more than going off and doing
        something the family cannot.
        """
        s = self.cfg.strategy
        metres = int(self.walk.metres(state.loc0, a.id))
        value = self._ride_value(a, FAMILY, repeats)
        if a.id in self.cfg.must_do and a.id not in state.child_done:
            value += MUST_DO_BONUS
        value -= self._walk_cost(state.walked0_min, walk)
        value -= s.queue_penalty_per_min * max(0, board - arrive)

        item = PlanItem(
            kind="ride", ride_id=a.id, name=a.name, park=a.park, land=a.land,
            group=FAMILY, start=state.t0, board=board, end=end, mode=mode,
            predicted_wait=wait, track=0, value=value, walk_min=walk,
            walk_m=metres,
        )
        return State(
            t0=end,
            t1=state.t1,
            loc0=a.id,
            loc1=state.loc1,
            child_done=state.child_done | {a.id},
            child_count=state.child_count + 1,
            adult_done=state.adult_done,
            pa_holds=state.pa_holds if pa_holds is None else pa_holds,
            pa_used=state.pa_used,
            cur0=Commitment(a.id, board, end, FAMILY),
            lunch_done=state.lunch_done,
            value=state.value + value,
            items=state.items + (item,),
            recent0=state.push_recent(a.id, end),
            walked0_min=state.walked0_min + walk,
            walked0_m=state.walked0_m + metres,
        )

    def _commit_rider_switch(self, state: State, a: Attraction, walk: int,
                             arrive: int, board: int, end: int, wait: int) -> State:
        """Both parents ride a height-restricted attraction on one queue."""
        s = self.cfg.strategy
        repeats = 1 if a.id in state.adult_done else 0
        # Two adult rides for the price of one wait, less the cost of parking
        # a bored child beside the exit for the duration.
        value = 2 * self._ride_value(a, PARENT_B, repeats)
        value -= self._walk_cost(state.walked0_min, walk)
        value -= s.queue_penalty_per_min * (board - arrive) * 2

        metres = int(self.walk.metres(state.loc0, a.id))
        item = PlanItem(
            kind="ride", ride_id=a.id, name=a.name, park=a.park, land=a.land,
            group=EVERYONE, start=state.t0, board=board, end=end,
            mode="rider_switch", predicted_wait=wait, track=0, value=value,
            walk_min=walk, walk_m=metres,
        )
        return replace(
            state, t0=end, t1=end, loc0=a.id, loc1=a.id, cur0=None,
            adult_done=state.adult_done | {a.id},
            value=state.value + value,
            items=state.items + (item,),
            walked0_min=state.walked0_min + walk,
            walked0_m=state.walked0_m + metres,
        )

    def _do_meal(self, state: State) -> State:
        end = state.t0 + self.lunch_len
        item = PlanItem(
            kind="meal", ride_id=None, name="Lunch", park="DLP", land="",
            group=EVERYONE, start=state.t0, board=state.t0, end=end, mode="",
            track=0, value=0.0,
        )
        # Everyone eats together, so this also resynchronises the two tracks.
        return replace(
            state, t0=end, t1=max(state.t1, end), lunch_done=True, cur0=None,
            loc1=state.loc0, items=state.items + (item,),
        )

    # -- free parent track ----------------------------------------------------

    def _expand_free_parent(self, state: State) -> list[State]:
        out: list[State] = []
        s = self.cfg.strategy
        t = state.t1

        if s.parallel_queues < 2:
            # The party moves as a single unit. The second parent has no
            # queue of their own, so the only thing they can do is stay with
            # the family. This is the comparison case: it is what a family
            # without a second queue is limited to.
            if state.cur0 is not None and state.cur0.end > t:
                return [self._shadow(state)]
            nxt = min(self.day_end, t + 15)
            return [replace(state, t1=nxt)] if nxt > t else []

        # Tag along on whatever the family is doing next.
        if state.cur0 is not None and state.cur0.end > t:
            out.append(self._shadow(state))

        for a in self._candidates(state, track=1):
            out.extend(self._parent_ride_options(state, a))

        if s.premier_access_budget > state.pa_used:
            out.extend(self._book_premier_options(state))

        # Doing nothing in particular is a legitimate move: better to wait for
        # the family than to go and queue for something pointless.
        nxt = min(self.day_end, t + 15)
        if nxt > t:
            out.append(replace(state, t1=nxt))
        return out

    def _shadow(self, state: State) -> State:
        """The free parent rejoins the family instead of splitting off.

        Worth a small bonus: a family holiday where one parent spends the
        whole day queueing alone is technically efficient and not what anyone
        actually wants.
        """
        cur = state.cur0
        assert cur is not None
        walk = self.walk.int_minutes(state.loc1, cur.ride_id, with_child=False)
        a = self.cat[cur.ride_id]
        # If they can reach the platform before the family boards, they ride
        # together; otherwise they just meet them at the exit.
        rides_along = state.t1 + walk <= cur.board
        value = 0.6 * self._appeal[a.id] * self.cfg.strategy.adult_solo_value_weight if rides_along else 0.0
        item = PlanItem(
            kind="ride" if rides_along else "walk",
            ride_id=cur.ride_id if rides_along else None,
            name=a.name if rides_along else f"Rejoin family at {a.name}",
            park=a.park, land=a.land, group=PARENT_B,
            start=state.t1, board=cur.board if rides_along else cur.end,
            end=cur.end, mode="standby" if rides_along else "",
            predicted_wait=0, track=1, value=value, walk_min=walk,
            walk_m=int(self.walk.metres(state.loc1, cur.ride_id)),
        )
        return replace(state, t1=cur.end, loc1=cur.ride_id,
                       value=state.value + value,
                       items=state.items + (item,))

    def _parent_ride_options(self, state: State, a: Attraction) -> Iterable[State]:
        s = self.cfg.strategy
        t = state.t1
        walk = self.walk.int_minutes(state.loc1, a.id, with_child=False)
        arrive = max(t + walk, self.cfg.open_minute(a.park))
        repeats = 1 if a.id in state.adult_done else 0
        close = self.cfg.close_minute(a.park) - CLOSING_SLACK

        modes: list[tuple[str, float]] = []
        q = self.oracle.expected_queue_min(a.id, arrive)
        modes.append(("standby", q))
        if s.allow_single_rider:
            sr = self.oracle.single_rider_wait(a.id, arrive)
            if sr is not None and sr < q - 5:
                modes.append(("single_rider", sr))

        for mode, wait in modes:
            board = int(arrive + wait)
            end = board + a.duration_min
            if end > close:
                continue
            value = self._ride_value(a, PARENT_B, repeats)
            value -= (s.walk_penalty_per_min * walk
                      + s.queue_penalty_per_min * max(0, board - arrive))
            item = PlanItem(
                kind="ride", ride_id=a.id, name=a.name, park=a.park, land=a.land,
                group=PARENT_B, start=t, board=board, end=end, mode=mode,
                predicted_wait=int(wait), track=1, value=value, walk_min=walk,
                walk_m=int(self.walk.metres(state.loc1, a.id)),
            )
            yield replace(
                state, t1=end, loc1=a.id,
                adult_done=state.adult_done | {a.id},
                value=state.value + value,
                items=state.items + (item,),
            )

        # -- hold a standby place for the family to join
        if s.allow_standby_hold and self._child_ok[a.id] and a.id not in state.child_done:
            yield from self._hold_option(state, a, walk, arrive, q)

    def _hold_option(self, state: State, a: Attraction, walk: int, arrive: int,
                     q: float) -> Iterable[State]:
        """Free parent queues; the family walks up and joins near the front.

        Only reachable when ``strategy.allow_standby_hold`` is on, because
        Disneyland Paris does not sanction it.
        """
        s = self.cfg.strategy
        parent_ready = int(arrive + q)
        family_walk = self.walk.int_minutes(state.loc0, a.id, with_child=True)
        # The family leaves whatever they are doing and heads over.
        family_arrive = max(state.t0, state.cur0.end if state.cur0 else state.t0) + family_walk
        board = max(parent_ready, family_arrive)
        end = board + a.duration_min
        if end > self.cfg.close_minute(a.park) - CLOSING_SLACK:
            return
        repeats = 1 if a.id in state.child_done else 0
        value = self._ride_value(a, EVERYONE, repeats)
        if a.id in self.cfg.must_do and a.id not in state.child_done:
            value += MUST_DO_BONUS
        value -= s.walk_penalty_per_min * walk
        value -= self._walk_cost(state.walked0_min, family_walk)
        value -= s.queue_penalty_per_min * max(0, board - family_arrive)

        item = PlanItem(
            kind="ride", ride_id=a.id, name=a.name, park=a.park, land=a.land,
            group=EVERYONE, start=state.t1, board=board, end=end, mode="hold",
            predicted_wait=int(q), track=1, value=value, walk_min=walk,
            walk_m=int(self.walk.metres(state.loc1, a.id)),
        )
        yield State(
            t0=end, t1=end, loc0=a.id, loc1=a.id,
            child_done=state.child_done | {a.id},
            child_count=state.child_count + 1,
            adult_done=state.adult_done,
            pa_holds=state.pa_holds, pa_used=state.pa_used, cur0=None,
            lunch_done=state.lunch_done,
            value=state.value + value,
            items=state.items + (item,),
            recent0=state.push_recent(a.id, end),
            walked0_min=state.walked0_min + family_walk,
            walked0_m=state.walked0_m + int(self.walk.metres(state.loc0, a.id)),
        )

    def _book_premier_options(self, state: State) -> Iterable[State]:
        """Buying a return window is the cleanest second queue there is: you
        hold a place on one ride while standing in line for another."""
        s = self.cfg.strategy
        held = {h[0] for h in state.pa_holds}
        scored = []
        for a in self.cat:
            if not a.premier_access or a.id in held or a.id in state.child_done:
                continue
            if not self._child_ok[a.id]:
                continue
            ret = self.oracle.premier_return(a.id, state.t1)
            if ret is None:
                continue
            ret_min, pa_wait = ret
            if ret_min > self.cfg.close_minute(a.park) - a.duration_min - CLOSING_SLACK:
                continue
            standby_then = self.oracle.expected_queue_min(a.id, ret_min)
            saving = standby_then - pa_wait
            if saving < s.premier_access_min_saving:
                continue
            bonus = MUST_DO_BONUS if a.id in self.cfg.must_do else 0.0
            scored.append((saving + bonus, a, ret_min, pa_wait))

        scored.sort(key=lambda x: -x[0])
        for _, a, ret_min, pa_wait in scored[:3]:
            item = PlanItem(
                kind="book_pa", ride_id=a.id, name=f"Book Premier Access: {a.name}",
                park=a.park, land=a.land, group=PARENT_B,
                start=state.t1, board=state.t1, end=state.t1 + PA_BOOKING_MIN,
                mode="premier", track=1, value=0.0,
                predicted_wait=int(pa_wait), return_minute=int(ret_min),
            )
            yield replace(
                state,
                t1=state.t1 + PA_BOOKING_MIN,
                pa_holds=state.pa_holds + ((a.id, int(ret_min), float(pa_wait)),),
                pa_used=state.pa_used + 1,
                items=state.items + (item,),
            )

    # ---- search -------------------------------------------------------------

    def _rank(self, s: State) -> float:
        """Compare states at different clock times fairly: banked value plus
        what the rest of the day is plausibly still worth."""
        remaining = max(0, self.day_end - min(s.t0, s.t1))
        return s.value + self._rate_hat * remaining

    def resume_from(self, t0: int, t1: int, loc0: str, loc1: str,
                    child_done: frozenset, adult_done: frozenset,
                    pa_holds: tuple = (), pa_used: int = 0,
                    lunch_done: bool = False) -> None:
        """Plan the *rest* of a day that is already partly done.

        The live replanner calls this every twenty minutes: the morning has
        already happened, so the search should start from where the party
        actually is, not from the turnstiles.
        """
        self._initial = State(
            t0=t0, t1=t1, loc0=loc0, loc1=loc1,
            child_done=child_done, child_count=len(child_done),
            adult_done=adult_done, pa_holds=pa_holds, pa_used=pa_used,
            cur0=None, lunch_done=lunch_done, value=0.0, items=(),
        )

    def solve(self) -> Plan:
        cfg = self.cfg
        init = getattr(self, "_initial", None)
        if init is None:
            start = min(cfg.open_minute(p) for p in cfg.hours)
            entrance = WalkMatrix.ENTRANCE
            init = State(
                t0=start, t1=start, loc0=entrance, loc1=entrance,
                child_done=frozenset(), child_count=0, adult_done=frozenset(),
                pa_holds=(), pa_used=0, cur0=None, lunch_done=False,
                value=0.0, items=(),
            )

        beam = [init]
        finished: list[State] = []
        width = cfg.strategy.beam_width
        guard = 0

        while beam and guard < 4000:
            guard += 1
            nxt: list[State] = []
            seen: dict[tuple, float] = {}
            for st in beam:
                if min(st.t0, st.t1) >= self.day_end:
                    finished.append(st)
                    continue
                for child in self._expand(st):
                    if not self._advances(st, child):
                        continue
                    k = child.key()
                    prior = seen.get(k)
                    if prior is not None and prior >= child.value:
                        continue
                    seen[k] = child.value
                    nxt.append(child)
            if not nxt:
                finished.extend(beam)
                break
            nxt.sort(key=self._rank, reverse=True)
            beam = nxt[:width]

        finished.extend(beam)
        if not finished:
            return Plan(items=[], value=0.0, notes=["no feasible plan"])

        best = max(finished, key=lambda s: s.value)
        plan = Plan(items=list(best.items), value=best.value)
        plan.notes.append(
            f"beam={width} candidates={CANDIDATES_PER_TRACK} "
            f"explored_layers={guard} value_rate={self._rate_hat:.3f}"
        )
        return plan

    @staticmethod
    def _advances(parent: State, child: State) -> bool:
        """Guard against zero-progress transitions looping the search."""
        return (child.t0 + child.t1) > (parent.t0 + parent.t1) or len(child.items) > len(parent.items)


def plan_day(catalog: Catalog, cfg: TripConfig, oracle: WaitOracle,
             walk: WalkMatrix | None = None) -> Plan:
    return Optimizer(catalog, cfg, oracle, walk).solve()
