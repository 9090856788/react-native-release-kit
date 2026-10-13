import { describe, it, expect } from 'vitest';
import { validateWorkflowYaml } from '../../src/utils/yaml.js';

describe('YAML & GitHub Actions Structure Validator', () => {
  it('validates a correct GitHub Actions workflow YAML', () => {
    const validYaml = `
name: PR Validation
on:
  pull_request:
    branches:
      - main
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;
    const res = validateWorkflowYaml(validYaml);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.parsed).toBeDefined();
    expect(res.parsed?.name).toBe('PR Validation');
  });

  it('rejects empty or whitespace-only content', () => {
    expect(validateWorkflowYaml('').valid).toBe(false);
    expect(validateWorkflowYaml('   \n  ').valid).toBe(false);
  });

  it('catches invalid YAML syntax', () => {
    const badSyntax = `
name: Bad Syntax
on: [
  invalid unclosed yaml
`;
    const res = validateWorkflowYaml(badSyntax);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('YAML syntax error'))).toBe(true);
  });

  it('detects mismatched GitHub Actions expression braces', () => {
    const mismatched = `
name: Test Mismatched
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo \${{ github.sha
`;
    const res = validateWorkflowYaml(mismatched);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Mismatched GitHub Actions expression braces'))).toBe(
      true,
    );
  });

  it('detects missing root properties (name, on, jobs)', () => {
    const missingName = `
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;
    const res = validateWorkflowYaml(missingName);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('detects invalid job structure (missing runs-on, empty steps)', () => {
    const missingRunsOn = `
name: Invalid Job
on: push
jobs:
  test:
    steps:
      - run: echo hi
`;
    const res = validateWorkflowYaml(missingRunsOn);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('runs-on'))).toBe(true);

    const emptySteps = `
name: Empty Steps
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps: []
`;
    const res2 = validateWorkflowYaml(emptySteps);
    expect(res2.valid).toBe(false);
    expect(res2.errors.some((e) => e.includes('steps'))).toBe(true);
  });
});

