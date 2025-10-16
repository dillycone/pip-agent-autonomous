"use client";

import { useMemo, useState } from "react";
import styles from "../../styles.module.css";

export type TabsProps = {
  children: React.ReactNode;
};

export type TabProps = {
  title: string;
  children: React.ReactNode;
};

export function Tabs({ children }: TabsProps) {
  const nodes = useMemo(() => {
    return (Array.isArray(children) ? children : [children]) as React.ReactElement<TabProps>[];
  }, [children]);

  const [idx, setIdx] = useState(0);

  return (
    <div className={styles.tabs}>
      <div className={styles.tabBar} role="tablist">
        {nodes.map((child, i) => (
          <button
            key={child.props.title ?? i}
            type="button"
            role="tab"
            aria-selected={idx === i}
            className={`${styles.tabBtn} ${idx === i ? styles.active : ""}`}
            onClick={() => setIdx(i)}
          >
            {child.props.title}
          </button>
        ))}
      </div>
      <div className={styles.tabPanel} role="tabpanel">
        {nodes[idx]}
      </div>
    </div>
  );
}

export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

Tab.displayName = "Tab";
