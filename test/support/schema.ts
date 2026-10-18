import { XmlDocument, XsdValidator } from 'libxml2-wasm';
import { xmlRegisterFsInputProviders } from 'libxml2-wasm/lib/nodejs.mjs';
import { readFileSync } from 'node:fs';
xmlRegisterFsInputProviders();
const path = new URL('../fixtures/schema/musicxml.xsd', import.meta.url);
const schema = XmlDocument.fromString(readFileSync(path, 'utf8'), {
  url: path.href,
});
const validator = XsdValidator.fromDoc(schema);

export function validate(xml: string): void {
  const doc = XmlDocument.fromString(xml);

  try {
    validator.validate(doc);
  } finally {
    doc.dispose();
  }
}
