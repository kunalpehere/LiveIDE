"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-monitoring";

export default class RuntimePanelBoundary extends Component<{ children: ReactNode }, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(error: Error) { reportClientError("react.boundary", error, "failed"); }
  render() {
    if (this.state.failed) return <div role="alert" className="p-4 space-y-3">
      <p>The runtime panel could not display. Your editor and drafts remain available.</p>
      <Button variant="outline" onClick={() => this.setState({failed: false})}>Retry runtime panel</Button>
    </div>;
    return this.props.children;
  }
}
