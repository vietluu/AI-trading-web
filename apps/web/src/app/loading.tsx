export default function Loading(): React.JSX.Element {
  return (
    <div className="space-y-5" aria-label="Loading dashboard">
      <div className="h-4 w-36 animate-pulse-soft rounded bg-muted" />
      <div className="h-12 max-w-2xl animate-pulse-soft rounded-xl bg-muted" />
      <div className="h-40 animate-pulse-soft rounded-2xl bg-muted" />
    </div>
  );
}
