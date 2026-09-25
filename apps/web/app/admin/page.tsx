import { AdminPanel } from "@/components/AdminPanel";
import { adminWallets } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <>
      <h1 className="mb-2 text-[2rem] font-semibold tracking-tight">Admin</h1>
      <p className="mb-8 max-w-[60ch] text-ink-2">Reserve, delegation and worker status for every pool. Actions are signed by the connected wallet, so it must hold the staker key.</p>
      <AdminPanel adminWallets={adminWallets()} />
    </>
  );
}
