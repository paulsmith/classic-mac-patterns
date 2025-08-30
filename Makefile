.PHONY: format
.DEFAULT_GOAL := help

GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m

help: ## Show this help message
	@echo "$(GREEN)Development Commands$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2}'
	@echo ""

format: ## Format source code
	uv run ruff format extract.py
	npx prettier -w index.html script.js style.css

typecheck: ## Run type checking with mypy
	uv run mypy extract.py

check: format typecheck ## Run all checks (format and typecheck)

web: ## Run web server
	python -m http.server

patterns/patterns.pbm:
	magick montage -tile 1x38 -geometry 8x8+0+0 -compress none patterns/pattern_0*.pbm $@
