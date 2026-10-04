import { useEffect, useRef, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./components/AuthProvider";
import { CartFab } from "./components/CartFab";
import { ChatProvider } from "./components/ChatProvider";
import { ChatWidget } from "./components/ChatWidget";
import { ConfigProvider } from "./components/ConfigProvider";
import { Nav } from "./components/Nav";
import { OfflineBanner } from "./components/OfflineBanner";
import { RecipeLibraryProvider } from "./components/RecipeLibraryProvider";
import { ShoppingListProvider } from "./components/ShoppingListProvider";
import { Splash } from "./components/Splash";
import { ToastProvider } from "./components/Toast";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { useAuth } from "./hooks/useAuth";
import { returnPath } from "./lib/returnPath";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
import { Insights } from "./pages/Insights";
import { NotFound } from "./pages/NotFound";
import { Planner } from "./pages/Planner";
import { RecipeDetail } from "./pages/RecipeDetail";
import { Shopping } from "./pages/Shopping";

/** State that belongs to one signed-in user. Remounted (so emptied) whenever the user changes. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ShoppingListProvider>
        <ChatProvider>
          <RecipeLibraryProvider>{children}</RecipeLibraryProvider>
        </ChatProvider>
      </ShoppingListProvider>
    </ToastProvider>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // Move focus to the new page on client-side navigation, like a full page load would.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    main.current?.focus();
  }, [pathname]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <OfflineBanner />
      <UpdatePrompt />
      <Nav />
      <main id="main" className="wrap" ref={main} tabIndex={-1}>
        {children}
      </main>
      <CartFab />
      <ChatWidget />
    </>
  );
}

function SignedInApp() {
  return (
    <Providers>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/shopping" element={<Shopping />} />
          <Route path="/list" element={<Navigate to="/shopping" replace />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/recipes/:id" element={<RecipeDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </Providers>
  );
}

function AuthRoutes() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Splash />;
  const authPage = user ? <Navigate to={returnPath(location.state)} replace /> : <AuthPage />;
  return (
    <Routes>
      <Route path="/login" element={authPage} />
      <Route path="/signup" element={authPage} />
      <Route
        path="*"
        element={
          // Keyed by user: switching accounts remounts every data provider, so nothing carries over.
          user ? <SignedInApp key={user.id} /> : <Navigate to="/login" replace state={{ from: location }} />
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ConfigProvider>
      <AuthProvider>
        <AuthRoutes />
      </AuthProvider>
    </ConfigProvider>
  );
}
