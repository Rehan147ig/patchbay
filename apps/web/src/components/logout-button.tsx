"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";

export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} loading={pending}>
      Sign out
    </Button>
  );
}
