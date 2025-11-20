# Testing Documentation

## Overview

This directory contains tests to ensure core functionality doesn't break during refactoring.

**Testing Framework:** We use [Vitest](https://vitest.dev/) for its excellent TypeScript support, blazing-fast execution, and Jest-compatible API. It requires minimal configuration and integrates seamlessly with our Node.js Firebase Functions environment.

## Test Structure

### Critical Path Tests (`critical-path.test.ts`)
**Purpose:** Ensure the model ALWAYS responds to users

These tests verify:
- ✅ Model responds to basic text input
- ✅ Model maintains conversation context
- ✅ Retry mechanism works
- ✅ Invalid model names fail gracefully
- ✅ Empty messages are handled
- ✅ Response structure is valid
- ✅ Function never throws unhandled errors

**Run with:** `npm run test:critical`

### Message Flow Tests (`message-flow.test.ts`)
**Purpose:** Integration tests for the full message processing pipeline

**Note:** These require actual API credentials and may fail in CI/local without `.env`

### Utility Tests (`utils.test.ts`)
**Purpose:** Fast unit tests for helper functions

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (recommended during development)
npm run test:watch

# Run only critical path tests
npm run test:critical

# Run with coverage report
npm run test:coverage

# Open UI test runner
npm run test:ui
```

## Before Refactoring Checklist

Before making ANY changes to core functions:

1. ✅ Run `npm run test:critical` - all tests MUST pass
2. ✅ Make your changes
3. ✅ Run `npm run test:critical` again - all tests MUST still pass
4. ✅ If tests fail, either:
   - Fix your code, OR
   - Update the tests if the behavior change is intentional

## Test Philosophy

**Critical Rule:** The model must ALWAYS respond to users, even if:
- The database is down
- The vector store fails
- Previous messages can't be fetched
- Rate limits are hit

Better to return a simple fallback response than to crash or return nothing.

## Adding New Tests

When adding new critical functionality:

1. Add a test to `critical-path.test.ts` if it affects user responses
2. Add to `utils.test.ts` if it's a helper function
3. Keep tests fast (< 30s each)
4. Use descriptive test names that explain WHAT is being tested

## Known Issues

- Tests require `OPENAI_API_KEY` environment variable
- Some type warnings from OpenAI SDK (safe to ignore - the API works despite strict types)
- Integration tests may be slow due to actual API calls

## CI/CD Integration

These tests should run:
- ✅ Before every deploy
- ✅ On every pull request
- ✅ In pre-commit hooks (optional)

## Troubleshooting

### Tests fail with "API key not found"
→ Make sure `.env` file exists with `OPENAI_API_KEY`

### Tests timeout
→ Increase timeout in `vitest.config.ts` or check internet connection

### Type errors in IDE
→ Safe to ignore if tests pass - it's a strictness issue with OpenAI SDK types

---

**Remember:** Tests are safety nets. They catch bugs BEFORE they reach users. Keep them updated!
