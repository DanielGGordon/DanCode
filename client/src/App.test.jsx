import { describe, it, expect } from 'vitest';
import App from './App.jsx';

describe('App', () => {
  it('is defined as a function component', () => {
    expect(typeof App).toBe('function');
  });
});
