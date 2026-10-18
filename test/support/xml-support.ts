import type { Document, Element, Node } from '@oozcitak/dom/lib/dom/interfaces.js';
import assert from 'node:assert/strict';
import { builder, create } from 'xmlbuilder2';
import { isXmlElement } from '../../src/musicxml/primitives.js';

const isDocument = (node: Node): node is Document & { readonly documentElement: Element } =>
  node.nodeType === 9 && (node as Document).documentElement !== null;

export const parse = (xml: string) => {
  const node = create(xml).node;

  assert.ok(isDocument(node));

  return node;
};

export type ScoreNode = Node;
export const childElements = (node: ScoreNode) => Array.from(node.childNodes).filter(isXmlElement);

export const elements = (node: ScoreNode | null | undefined, tag: string): Element[] => {
  assert.ok(node && (isXmlElement(node) || isDocument(node)));

  return Array.from(node.getElementsByTagName(tag)).filter((element) => element !== undefined);
};

export const serialize = (node: ScoreNode) => builder(node).toString({ headless: true });
export const texts = (node: ScoreNode | null | undefined, tag: string) =>
  elements(node, tag).map((e) => e.textContent);
export const directionTexts = (node: ScoreNode | null | undefined) =>
  elements(node, 'direction').map((d) => texts(d, 'words').join(''));
export const millimeters = (
  xml: Document | undefined,
  node: ScoreNode | null | undefined,
  tag: string,
) =>
  (Number(texts(node, tag)[0]) * Number(texts(xml, 'millimeters')[0])) /
  Number(texts(xml, 'tenths')[0]);
export const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);
