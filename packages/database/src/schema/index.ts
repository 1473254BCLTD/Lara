/**
 * Central registry for Lara database schema definitions.
 *
 * Tables, relationships, and other schema objects
 * will be exported from this module.
 *
 * Drizzle ORM and Drizzle Kit will use these definitions.
 */

export { tenants } from "./tenants.js";

export type {
  Tenant,
  NewTenant,
} from "./tenants.js";

// Global staff accounts
export { users } from "./users.js";
export type {
  User,
  NewUser,
} from "./users.js";

// Tenant staff memberships
export {
  tenantMemberships,
} from "./tenant-memberships.js";

export type {
  TenantMembership,
  NewTenantMembership,
} from "./tenant-memberships.js";

// Global customer authentication
export {
  customerAuthAccounts,
} from "./customer-auth-accounts.js";

export type {
  CustomerAuthAccount,
  NewCustomerAuthAccount,
} from "./customer-auth-accounts.js";

// Tenant-specific customers
export { customers } from "./customers.js";

export type {
  Customer,
  NewCustomer,
} from "./customers.js";