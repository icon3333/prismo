import { AnonymousModeProvider } from "@/components/domain/anonymous-mode";
import { Masthead } from "@/components/ptsim";
import { AccountPicker } from "@/components/shell/account-picker";
import { ErrorBoundary } from "@/components/shell/error-boundary";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AnonymousModeProvider>
      <AccountPicker />
      <div className="min-h-screen flex flex-col">
        <Masthead />
        <main className="flex-1 min-w-0 p-7 max-w-[1200px] w-full mx-auto">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </AnonymousModeProvider>
  );
}
