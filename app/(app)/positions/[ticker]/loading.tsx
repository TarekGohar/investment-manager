export default function PositionLoading() {
  return (
    <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-[34px]">
        <div className="min-w-0 flex-1 space-y-6">
          <div className="h-[72px] animate-pulse rounded-card bg-panel" />
          <div className="h-[260px] animate-pulse rounded-card bg-panel" />
          <div className="h-[200px] animate-pulse rounded-card bg-panel" />
        </div>
        <div className="w-full lg:w-[400px] lg:shrink-0">
          <div className="h-[420px] animate-pulse rounded-card bg-panel" />
        </div>
      </div>
    </div>
  );
}
