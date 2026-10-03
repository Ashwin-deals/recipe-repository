import { useEffect, useRef, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CartFab } from "./components/CartFab";
import { ConfigProvider } from "./components/ConfigProvider";
import { Nav } from "./components/Nav";
import { OfflineBanner } from "./components/OfflineBanner";
import { ShoppingListProvider } from "./components/ShoppingListProvider";
import { ToastProvider } from "./components/Toast";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { Dashboard } from "./pages/Dashboard";
import { Insights } from "./pages/Insights";
import { NotFound } from "./pages/NotFound";
import { Planner } from "./pages/Planner";
import { RecipeDetail } from "./pages/RecipeDetail";
import { Shopping } from "./pages/Shopping";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <ToastProvider>
        <ShoppingListProvider>{children}</ShoppingListProvider>
      </ToastProvider>
    </ConfigProvider>
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
    </>
  );
}

export default function App() {
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
