export default function AppLoading() {
  return (
    <div className="flex h-[calc(100vh-72px)] flex-1 items-center justify-center">
      <div
        className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-text"
        aria-label="Loading"
      />
    </div>
  );
}
