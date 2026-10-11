import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseToolCallFromText,
  parseToolCallsFromText,
  stripToolCallsFromText,
} from '../src/utils/toolParserCore.js';

describe('Tool-call protocol regression coverage', () => {
  it('parses Dots/Invoke XML calls and named parameters', () => {
    const response = '<dots_function_call><invoke name="read_file"><parameter name="path">package.json</parameter></invoke></dots_function_call>';
    assert.deepEqual(parseToolCallFromText(response), {
      tool: 'read_file',
      args: { path: 'package.json' },
      rawBlock: '<invoke name="read_file"><parameter name="path">package.json</parameter></invoke>',
    });
  });

  it('parses multiple distinct calls from one XML wrapper', () => {
    const response = '<dots_function_call><invoke name="read_file"><parameter name="path">package.json</parameter></invoke><invoke name="read_file"><parameter name="path">vite.config.ts</parameter></invoke></dots_function_call>';
    assert.deepEqual(parseToolCallsFromText(response).map((call) => [call.tool, call.args.path]), [
      ['read_file', 'package.json'],
      ['read_file', 'vite.config.ts'],
    ]);
  });

  it('collapses exact duplicate tool calls within one assistant response', () => {
    const response = '<dots_function_call><invoke name="list_directory"><parameter name="path">.</parameter></invoke><invoke name="list_directory"><parameter name="path">.</parameter></invoke><invoke name="read_file"><parameter name="path">README.md</parameter></invoke><invoke name="read_file"><parameter name="path">README.md</parameter></invoke></dots_function_call>';
    assert.deepEqual(parseToolCallsFromText(response).map((call) => [call.tool, call.args.path]), [
      ['list_directory', '.'],
      ['read_file', 'README.md'],
    ]);
  });

  it('decodes XML entities and parses JSON-valued parameters', () => {
    const response = '<dots_function_call><invoke name="write_file"><parameter name="path">a&amp;b.txt</parameter><parameter name="content">{"enabled":true}</parameter></invoke></dots_function_call>';
    assert.deepEqual(parseToolCallFromText(response)?.args, { path: 'a&b.txt', content: { enabled: true } });
  });

  it('preserves the existing JSON tool_call protocol', () => {
    const response = 'Working... <tool_call>{"tool":"read_file","args":{"path":"README.md"}}</tool_call>';
    assert.deepEqual(parseToolCallFromText(response)?.args, { path: 'README.md' });
  });

  it('strips complete XML tool blocks while preserving surrounding prose', () => {
    const response = 'I will inspect the project. <dots_function_call><invoke name="read_file"><parameter name="path">package.json</parameter></invoke></dots_function_call> Done.';
    assert.equal(stripToolCallsFromText(response), 'I will inspect the project. Done.');
  });

  it('hides an incomplete streamed tool block instead of leaking raw markup', () => {
    assert.equal(stripToolCallsFromText('Answer so far <dots_function_call><invoke name="read_file">'), 'Answer so far');
    assert.equal(stripToolCallsFromText('<invoke name="read_file"><parameter name="path">README.md</parameter>'), '');
  });
});
