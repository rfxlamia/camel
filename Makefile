# =============================================================================
# Camel Kanban — Makefile
# =============================================================================
# Run `make help` to see all available targets.

.DEFAULT_GOAL := help

NPM            := npm
DOCKER_COMPOSE := docker compose

# ---- Development -----------------------------------------------------------

.PHONY: install dev dev-server dev-client

install: ## Install all dependencies
	@$(NPM) install

dev: ## Start both server and client dev servers
	@$(NPM) run dev

dev-server: ## Start server dev server only
	@$(NPM) run dev:server

dev-client: ## Start client dev server only
	@$(NPM) run dev:client

# ---- Build & Test ----------------------------------------------------------

.PHONY: build test test-watch start typecheck

build: ## Build server and client
	@$(NPM) run build

test: ## Run server tests
	@$(NPM) run test

test-watch: ## Run server tests in watch mode
	@$(NPM) run test:watch --workspace=server

start: ## Start the built server (requires `make build` first)
	@cd server && node dist/index.js

typecheck: ## Type-check both workspaces (tsc --noEmit)
	@echo "Checking server..."
	@cd server && npx tsc --noEmit
	@echo "Checking client..."
	@cd client && npx tsc --noEmit
	@echo "✓ All types OK"

# ---- Database & Services ---------------------------------------------------

.PHONY: db-up services-up db-down db-migrate db-seed db-reset db-reset-hard logs

db-up: ## Start PostgreSQL container
	@$(DOCKER_COMPOSE) up -d db

services-up: ## Start all services (PostgreSQL + Redis)
	@$(DOCKER_COMPOSE) up -d

db-down: ## Stop all containers (preserves volumes)
	@$(DOCKER_COMPOSE) stop

db-migrate: ## Run database migrations
	@$(NPM) run db:migrate

db-seed: ## Seed the database
	@$(NPM) run db:seed

db-reset: db-down db-up db-migrate db-seed ## Reset DB (stop → start → migrate → seed)

db-reset-hard: ## ⚠️  DESTRUCTIVE: removes volumes, then up + migrate + seed
	@echo "⚠️  This will DELETE all database data (volumes removed)."
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || (echo "Aborted." && exit 1)
	$(DOCKER_COMPOSE) down -v
	$(DOCKER_COMPOSE) up -d db
	$(NPM) run db-migrate
	$(NPM) run db-seed

logs: ## Tail docker compose logs
	@$(DOCKER_COMPOSE) logs -f

# ---- Cleanup ---------------------------------------------------------------

.PHONY: clean

clean: ## ⚠️  Remove node_modules, dist, and stop containers (destructive)
	@echo "⚠️  Removing node_modules, dist, and stopping containers..."
	rm -rf node_modules client/node_modules server/node_modules
	rm -rf client/dist server/dist
	@$(DOCKER_COMPOSE) down -v 2>/dev/null || true
	@echo "✓ Cleaned"

# ---- Docs (separate remote) -----------------------------------------------

.PHONY: docs-commit docs-push docs-pull docs-sync

docs-commit: ## Commit all docs changes (auto-generate message via comma)
	@cd docs && git add -A && comma

docs-push: ## Push docs to remote
	@cd docs && git push

docs-pull: ## Pull docs from remote
	@cd docs && git pull

docs-sync: ## Pull then push docs (sync with remote)
	@cd docs && git pull --rebase && git push

# ---- Help ------------------------------------------------------------------

.PHONY: help

help: ## Show this help message
	@echo ""
	@echo "Camel Kanban — Available targets:"
	@echo "──────────────────────────────────"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
