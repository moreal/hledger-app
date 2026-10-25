/** One physical copy. ISBN identifies its edition, never its ledger commodity. */
export interface BookCopy {
  id: string;
  commodity: string;
  isbn: string;
  title: string;
}

function isbn13CheckDigit(firstTwelve: string): string {
  const sum = [...firstTwelve].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return String((10 - (sum % 10)) % 10);
}

/** Accept formatted ISBN-10/13 and return the edition's canonical ISBN-13. */
export function normalizeIsbn(input: string): string {
  const isbn = input.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce(
      (total, digit, index) => total + (digit === 'X' ? 10 : Number(digit)) * (10 - index),
      0,
    );
    if (sum % 11 !== 0) throw new Error('Invalid ISBN check digit.');
    const prefix = `978${isbn.slice(0, 9)}`;
    return prefix + isbn13CheckDigit(prefix);
  }
  if (!/^97[89]\d{10}$/.test(isbn)) throw new Error('Enter a valid ISBN-10 or ISBN-13.');
  if (isbn13CheckDigit(isbn.slice(0, 12)) !== isbn[12])
    throw new Error('Invalid ISBN check digit.');
  return isbn;
}

/** Caller supplies a persisted random 80-bit copy ID, independently of ISBN. */
export function createBookCommodity(id: string): string {
  if (!/^[a-f0-9]{20}$/.test(id))
    throw new Error('Book copy ID must contain 20 lowercase hexadecimal characters.');
  return `asset:book:${id}`;
}
