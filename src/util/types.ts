/**
 * Small shared types.
 *
 * @module
 */

/** Who performed a mutation, as recorded in hook events and audit trails. */
export interface Actor {
  id: string;
  /** The kind of actor (`"user"`, `"service"`, `"portal"`…), when the product records it. */
  type?: string;
  email?: string;
  name?: string;
}
