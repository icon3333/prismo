import { AnonymousModeProvider } from "@/components/domain/anonymous-mode";
import { Sidebar } from "@/components/shell/sidebar";
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
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 min-w-0 p-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </AnonymousModeProvider>
  );
}
