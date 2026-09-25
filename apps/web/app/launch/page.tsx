import { LaunchWizard } from "@/components/LaunchWizard";
import { loadRegistry } from "@/lib/registry";

export const dynamic = "force-dynamic";

export default async function LaunchPage() {
  const reg = loadRegistry();
  return (
    <>
      <h1 className="mb-2 text-[2rem] font-semibold tracking-tight">Launch a pool</h1>
      <p className="mb-8 max-w-[62ch] text-ink-2">
        Pick an asset, name the token, approve five transactions. You get a stake pool that pays its holders in that asset every
        epoch, and a share of the pool&rsquo;s platform fee for as long as it runs. The pool is a plain SPL stake pool: {reg.brand.name} never
        holds anyone&rsquo;s stake, and neither do you.
      </p>
      <LaunchWizard brand={reg.brand.name} validatorName={reg.validator.name} />
    </>
  );
}
