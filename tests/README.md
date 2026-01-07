# Test Suite Guide

## Quick Start

```bash
# Run all tests
npm test

# Watch mode (auto-rerun on changes)
npm run test:watch

# Coverage report
npm run test:coverage
```

## Test Structure

```
src/
├── __tests__/
│   ├── unified-tools.test.ts       # 6 unified CRUD tools (50+ tests)
│   ├── structured-content.test.ts  # Content parsing (27 tests) ✅
│   └── workspace-config.test.ts    # Multi-workspace config ✅
└── openapi-mcp-server/
    ├── client/__tests__/
    ├── mcp/__tests__/
    └── openapi/__tests__/
```

## What's Tested

### Unified Tools (notion-page, notion-blocks, etc.)
- ✅ CRUD operations (get, create, update, delete)
- ✅ Template support
- ✅ Relation modes (append, remove, replace)
- ✅ Structured content parsing
- ✅ Error handling

### Structured Content
- ✅ Headings (h1:, h2:, h3:)
- ✅ Lists (-, 1., [], [x])
- ✅ Callouts (callout[icon,color]:, !>)
- ✅ Quotes (>), Dividers (---)
- ✅ Complex mixed content

### Workspace Configuration
- ✅ Multi-workspace discovery (NOTION_TOKEN_*)
- ✅ Default workspace selection
- ✅ Header generation with API version
- ✅ Legacy fallback (NOTION_TOKEN)

## Writing New Tests

### Example Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('Feature Name', () => {
  beforeEach(() => {
    // Setup
  })

  it('should do something when conditions are met', () => {
    // Arrange
    const input = {...}

    // Act
    const result = functionUnderTest(input)

    // Assert
    expect(result).toBe(expected)
  })
})
```

### Mocking HttpClient

```typescript
import { vi } from 'vitest'
import { HttpClient } from '../openapi-mcp-server/client/http-client'

vi.mock('../openapi-mcp-server/client/http-client')

const mockHttpClient = {
  call: vi.fn(),
  rawRequest: vi.fn(),
}

mockHttpClient.call.mockResolvedValue({ ... })
```

## Testing Checklist

When adding new features, test:
- ✅ Happy path (normal usage)
- ✅ Error cases (invalid input)
- ✅ Edge cases (empty, null, extreme values)
- ✅ Integration points (multi-tool flows)

## Debugging Tests

```bash
# Run specific test file
npm test unified-tools

# Run specific test
npm test -- -t "should create a page"

# Verbose output
npm test -- --reporter=verbose

# Debug mode
node --inspect-brk node_modules/.bin/vitest run
```

## Coverage Goals

- **Statements**: 80%+
- **Branches**: 75%+
- **Functions**: 80%+
- **Lines**: 80%+

Current focus:
- ✅ Unified tools core logic
- ✅ Structured content parsing
- ✅ Workspace configuration
- ⏳ Error handling paths
- ⏳ MCP server lifecycle

## CI/CD Integration

Tests run automatically on:
- Every push
- Pull requests
- Pre-commit hooks (recommended)

## Troubleshooting

### "Cannot find module" errors
```bash
npm run build
npm test
```

### TypeScript errors in tests
```bash
# Check types
npx tsc --noEmit

# Fix imports
npm run build
```

### Mock not working
```typescript
// Use vi.mock() BEFORE importing
vi.mock('./module')
import { function } from './module'
```

## Best Practices

1. **Test names**: Describe behavior, not implementation
   - ✅ "should create page with template"
   - ❌ "testCreatePage"

2. **One assertion concept per test**
   - Focus on single behavior
   - Makes failures easier to debug

3. **Arrange-Act-Assert** pattern
   - Setup → Execute → Verify

4. **Mock external dependencies**
   - HttpClient, file system, APIs
   - Keep tests fast and isolated

5. **Clean up after tests**
   - Use afterEach for cleanup
   - Reset mocks between tests

## Resources

- [Vitest Docs](https://vitest.dev/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [TEST-SUMMARY.md](./TEST-SUMMARY.md) - Detailed test coverage report
