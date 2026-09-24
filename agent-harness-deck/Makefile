DECK = personal_agent_harness

all: $(DECK).pdf

$(DECK).pdf: $(DECK).tex
	pdflatex -interaction=nonstopmode -halt-on-error $(DECK).tex
	pdflatex -interaction=nonstopmode -halt-on-error $(DECK).tex

clean:
	rm -f *.aux *.log *.nav *.out *.snm *.toc *.vrb

.PHONY: all clean
