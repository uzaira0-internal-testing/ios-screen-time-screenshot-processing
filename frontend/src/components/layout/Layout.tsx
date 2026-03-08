import { ReactNode } from "react";
import { Header } from "./Header";

interface LayoutProps {
  children: ReactNode;
  /** Set to true to disable scrolling (e.g., for annotation workspace) */
  noScroll?: boolean;
}

export const Layout = ({ children, noScroll = false }: LayoutProps) => {
  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
      <Header />
      <main
        className={`flex-1 ${noScroll ? "overflow-hidden" : "overflow-auto"}`}
      >
        {children}
      </main>
    </div>
  );
};
