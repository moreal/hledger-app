import assert from 'node:assert/strict';
import test from 'node:test';
import { tokens } from './index.ts';

// WCAG relative luminance applies to color channels, never to monetary values.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

test('body, muted, accent and semantic text remain readable on gallery surfaces', () => {
  for (const color of [
    tokens.colors.text,
    tokens.colors.muted,
    tokens.colors.accent,
    tokens.colors.success,
    tokens.colors.warning,
    tokens.colors.danger,
  ]) {
    for (const surface of [tokens.colors.background, tokens.colors.surface]) {
      assert.ok(
        contrast(color, surface) >= 4.5,
        `${color} on ${surface} has insufficient contrast`,
      );
    }
  }
  assert.ok(contrast(tokens.colors.surface, tokens.colors.accent) >= 4.5);
});

test('body and supporting text remain readable across neutral interaction surfaces', () => {
  for (const surface of [
    tokens.colors.surfaceSubtle,
    tokens.colors.surfaceHover,
    tokens.colors.surfacePressed,
    tokens.colors.disabledSurface,
  ]) {
    assert.match(surface, /^#[0-9A-F]{6}$/);
    for (const foreground of [
      tokens.colors.text,
      tokens.colors.muted,
      tokens.colors.disabledText,
    ]) {
      assert.ok(
        contrast(foreground, surface) >= 4.5,
        `${foreground} on ${surface} must reach 4.5:1`,
      );
    }
  }
});

test('semantic foregrounds remain readable on their subtle backgrounds', () => {
  const pairs = [
    [tokens.colors.accent, tokens.colors.accentSubtle],
    [tokens.colors.success, tokens.colors.successSubtle],
    [tokens.colors.warning, tokens.colors.warningSubtle],
    [tokens.colors.danger, tokens.colors.dangerSubtle],
  ] as const;
  for (const [foreground, surface] of pairs) {
    assert.match(surface, /^#[0-9A-F]{6}$/);
    assert.ok(contrast(foreground, surface) >= 4.5, `${foreground} on ${surface} must reach 4.5:1`);
  }
});

test('primary labels remain readable in default, hover and pressed states', () => {
  assert.match(tokens.colors.onAccent, /^#[0-9A-F]{6}$/);
  for (const surface of [
    tokens.colors.accent,
    tokens.colors.accentHover,
    tokens.colors.accentPressed,
  ]) {
    assert.ok(
      contrast(tokens.colors.onAccent, surface) >= 4.5,
      `${tokens.colors.onAccent} on ${surface} must reach 4.5:1`,
    );
  }
});

test('featured account amounts and supporting text are readable on the feature surface', () => {
  for (const foreground of [tokens.colors.featureText, tokens.colors.featureMuted]) {
    assert.ok(contrast(foreground, tokens.colors.featureBackground) >= 4.5);
  }
});

test('control boundaries and focus indicators remain distinguishable on control surfaces', () => {
  for (const foreground of [tokens.colors.borderStrong, tokens.colors.focus]) {
    assert.match(foreground, /^#[0-9A-F]{6}$/);
    for (const surface of [
      tokens.colors.surface,
      tokens.colors.background,
      tokens.colors.surfaceSubtle,
      tokens.colors.surfaceHover,
      tokens.colors.surfacePressed,
    ]) {
      assert.ok(contrast(foreground, surface) >= 3, `${foreground} on ${surface} must reach 3:1`);
    }
  }
});

test('control and typography tokens support touch targets and readable base text', () => {
  assert.ok(tokens.size.controlMin >= 44);
  assert.ok(tokens.fontSize.body >= 16);
  assert.ok(tokens.space.lg <= tokens.size.controlMin);
  for (const value of Object.values(tokens.space)) assert.ok(value > 0 && value % 4 === 0);
});
