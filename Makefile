export PATH			:=		$(PWD)/bin:$(PATH)
export INSIDE_STAGING_DIR	:=		false

all: lint build test

pre-build: FORCE
	rm -f .eslintcache .build-finished

build:

lint:
	pnpm prettier -c .
	pnpm eslint --cache .

test:

format:
	pnpm prettier -w .

clean:
	rm -f .env-checked .eslintcache .build-finished
	find . -type d -name "dist" -a ! -path '*/node_modules/*' | xargs rm -rf

.env-checked: bin/check-env
	./bin/check-env
	touch .env-checked

include .env-checked

.PHONY: all lint test
FORCE:
