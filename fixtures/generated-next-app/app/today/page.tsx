import Link from "next/link";
import { Button } from "../../components/Button";

export default function TodayPage() {
  return (
    <div className="flex flex-col gap-6 p-6 min-h-screen">
      <Link href="/" className="text-brand-600 text-sm font-medium">
        <span>← Back</span>
      </Link>
      <h1 className="text-3xl font-bold">Today</h1>
      <form className="flex flex-col gap-4 max-w-md">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Habit
          <input type="text" placeholder="e.g. Read 10 pages" className="px-3 py-2 border border-gray-300 rounded-md text-sm" />
        </label>
        <Button label="Save habit" />
      </form>
      <div className="gap-2 text-gray-500 text-sm hidden md:flex">
        <p>Tip: habits stick best when they are small.</p>
      </div>
    </div>
  );
}
