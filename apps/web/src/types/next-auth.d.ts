import type { DefaultSession } from "next-auth";
import type { Role } from "@patchbay/domain";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string;
      role: Role;
    } & DefaultSession["user"];
  }
}
