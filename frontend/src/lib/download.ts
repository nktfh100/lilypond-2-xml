export function downloadMusicXml(filename: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'application/vnd.recordare.musicxml+xml' }),
  );
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
