.PHONY: help install install-dev test lint typecheck run-dev docker-up docker-down clean

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install production dependencies
	pip install -e .

install-dev: ## Install all dependencies including dev
	pip install -e ".[dev]"

test: ## Run all unit tests
	pytest tests/unit/ -v

test-cov: ## Run tests with coverage report
	pytest tests/unit/ -v --cov=src --cov-report=term-missing --cov-report=html

lint: ## Run ruff linter
	ruff check src/ tests/
	ruff format --check src/ tests/

lint-fix: ## Auto-fix lint issues
	ruff check --fix src/ tests/
	ruff format src/ tests/

typecheck: ## Run mypy type checker
	mypy src/ --ignore-missing-imports

run-dev: ## Start the API server in development mode
	uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload

docker-up: ## Start all services with Docker Compose
	docker compose -f docker/docker-compose.yml up -d

docker-down: ## Stop all Docker Compose services
	docker compose -f docker/docker-compose.yml down

docker-build: ## Build Docker images
	docker compose -f docker/docker-compose.yml build

clean: ## Remove Python cache files
	find . -type f -name "*.pyc" -delete
	find . -type d -name "__pycache__" -delete
	find . -type d -name "*.egg-info" -exec rm -rf {} +
	rm -rf .coverage htmlcov/ .pytest_cache/ .mypy_cache/
