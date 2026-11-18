import { ZipFile } from "yazl";

/** 小于 4 KiB 的真实 OOXML 临时夹具，只验证既有 Word 查看器，不复制分发载荷。 */
export async function tinyComposerDocx() {
  const zip = new ZipFile();
  const chunks = [];
  zip.addBuffer(
    Buffer.from(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "[Content_Types].xml",
  );
  zip.addBuffer(
    Buffer.from(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "_rels/.rels",
  );
  zip.addBuffer(
    Buffer.from(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX preview content</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
    ),
    "word/document.xml",
  );
  const complete = new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
    zip.outputStream.on("error", reject);
  });
  zip.end();
  return complete;
}
