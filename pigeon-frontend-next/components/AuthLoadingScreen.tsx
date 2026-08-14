import { Loader2 } from "lucide-react";

interface AuthLoadingScreenProps {
  message?: string;
}

export function AuthLoadingScreen({ message = "Loading...." }: AuthLoadingScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center bg-background">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/15 via-background to-background" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-gradient-to-br from-primary/15 to-transparent rounded-full blur-3xl opacity-70" />
      </div>

      <div className="relative flex flex-col items-center gap-5 max-w-sm text-center px-6">
        <div className="rounded-full bg-primary/10 p-4">
          <Loader2 className="h-8 w-8 text-primary animate-spin" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">{message}</p>
          <p className="text-sm text-muted-foreground">
            This will only take a moment…
          </p>
        </div>
      </div>
    </div>
  );
}
