import React, { createContext, useContext, useState, useEffect } from 'react';

type Breadcrumb = string[];

interface BreadcrumbContextType {
  breadcrumbs: Breadcrumb;
  setBreadcrumbs: (crumbs: Breadcrumb) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextType | undefined>(undefined);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb>([]);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, setBreadcrumbs }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs(crumbs?: Breadcrumb) {
  const context = useContext(BreadcrumbContext);
  if (!context) {
    throw new Error('useBreadcrumbs must be used within a BreadcrumbProvider');
  }

  const { breadcrumbs, setBreadcrumbs } = context;

  useEffect(() => {
    if (crumbs) {
      setBreadcrumbs(crumbs);
    }
  }, [JSON.stringify(crumbs)]); // Use stringify for deep array comparison

  return { breadcrumbs, setBreadcrumbs };
}
