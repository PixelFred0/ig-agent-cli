export function formatJson(data: unknown, pretty: boolean): string {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

export function printJson(data: unknown, pretty: boolean): void {
  process.stdout.write(formatJson(data, pretty) + "\n");
}
