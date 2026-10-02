let toastListener: (message: string) => void = () => {};

/** Show a short message at the bottom of the screen (rendered by <Toaster />). */
export const toast = (message: string) => toastListener(message);
export const onToast = (listener: (message: string) => void) => {
  toastListener = listener;
};

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function copyLink(message: string) {
  try {
    await navigator.clipboard.writeText(location.href);
    toast(message);
  } catch {
    toast(location.href);
  }
}
