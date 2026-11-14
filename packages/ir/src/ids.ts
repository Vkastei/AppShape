import { z } from "zod";

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Ids are stable, opaque strings. Generated ids carry a kind prefix (`n_`, `f_`, `op_`, …). */
export const IdSchema = z
  .string()
  .regex(ID_PATTERN, "ids may only contain letters, digits, '_' and '-' (max 64)");

export type IdPrefix = "n" | "f" | "op" | "cs" | "a" | "b" | "c" | "rq" | "s";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function createId(prefix: IdPrefix, length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = `${prefix}_`;
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return id;
}
