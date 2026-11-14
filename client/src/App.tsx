import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import CheckInPage from "./pages/CheckInPage";
import QualitySignalsPage from "./pages/QualitySignalsPage";
import ClinicOnboardingPage from "./pages/ClinicOnboardingPage";
import VoiceSimPage from "./pages/VoiceSimPage";
import GuidedDemoPage from "./pages/GuidedDemoPage";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/demo"} component={() => <GuidedDemoPage />} />
      <Route path={"/web"} component={() => <CheckInPage />} />
      <Route path={"/check-in"} component={() => <CheckInPage />} />
      <Route path={"/voice-sim"} component={() => <VoiceSimPage />} />
      <Route path={"/quality"} component={() => <QualitySignalsPage />} />
      <Route path={"/signals"} component={() => <QualitySignalsPage />} />
      <Route path={"/onboarding"} component={() => <ClinicOnboardingPage />} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
