import { useState } from "react";
import { postAwsConfig } from "../api";

type Props = {
  onConnected: (info: { region: string; account?: string }) => void;
};

export function SetupWizard({ onConnected }: Props) {
  const [region, setRegion] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const out = await postAwsConfig({
        region: region.trim(),
        accessKeyId: accessKeyId.trim(),
        secretAccessKey,
      });
      setRegion("");
      setAccessKeyId("");
      setSecretAccessKey("");
      onConnected({ region: region.trim(), account: out.account });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup-wizard">
      <h2 className="setup-wizard-title">Connect to AWS</h2>
      <form className="setup-form" onSubmit={onSubmit}>
        <label className="setup-field">
          <span>AWS Region</span>
          <input
            required
            autoComplete="off"
            placeholder="e.g. ap-south-1"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          />
        </label>
        <label className="setup-field">
          <span>Access key ID</span>
          <input
            required
            autoComplete="off"
            spellCheck={false}
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value.trim())}
          />
        </label>
        <label className="setup-field">
          <span>Secret access key</span>
          <input
            required
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
          />
        </label>
        {error && <div className="error-banner setup-error">{error}</div>}
        <button
          type="submit"
          className="btn btn-primary setup-submit"
          disabled={busy}
        >
          {busy ? "Verifying…" : "Connect"}
        </button>
      </form>
    </div>
  );
}
