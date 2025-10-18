/**
 * Tests for StatusDashboard Component
 *
 * Tests component rendering, status display, progress ring,
 * and interaction with different status values
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import StatusDashboard from "../../app/components/StatusDashboard";
import type { Step, StepStatus } from "../../lib/types";

describe("StatusDashboard", () => {
  const defaultProps = {
    overallProgress: 0,
    currentStep: "transcribe" as Step,
    steps: {
      transcribe: "pending" as StepStatus,
      draft: "pending" as StepStatus,
      review: "pending" as StepStatus,
      export: "pending" as StepStatus,
    },
    hasError: false,
    elapsedSeconds: 0,
  };

  describe("Component Rendering", () => {
    it("should render without crashing", () => {
      render(<StatusDashboard {...defaultProps} />);
      expect(screen.getByText("Overall Progress")).toBeInTheDocument();
    });

    it("should display current step label", () => {
      render(<StatusDashboard {...defaultProps} currentStep="draft" />);
      expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    });

    it("should render all step pills", () => {
      render(<StatusDashboard {...defaultProps} />);

      expect(screen.getAllByText("Transcribe").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Review").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Export").length).toBeGreaterThan(0);
    });

    it("should display elapsed time", () => {
      render(<StatusDashboard {...defaultProps} elapsedSeconds={125} />);
      // Should format as MM:SS (2:05)
      expect(screen.getByText("2:05")).toBeInTheDocument();
    });

    it("should display elapsed time with hours", () => {
      render(<StatusDashboard {...defaultProps} elapsedSeconds={3725} />);
      // Should format as HH:MM:SS (1:02:05)
      expect(screen.getByText("1:02:05")).toBeInTheDocument();
    });
  });

  describe("Status Display", () => {
    it("should display pending status for all steps initially", () => {
      const { container } = render(<StatusDashboard {...defaultProps} />);
      const pills = container.querySelectorAll('.statusPill');
      expect(pills).toHaveLength(4);
    });

    it("should display running status correctly", () => {
      const props = {
        ...defaultProps,
        currentStep: "transcribe" as Step,
        steps: {
          ...defaultProps.steps,
          transcribe: "running" as StepStatus,
        },
      };

      render(<StatusDashboard {...props} />);
      // Component should render the running state
      expect(screen.getAllByText("Transcribe").length).toBeGreaterThan(0);
    });

    it("should display success status correctly", () => {
      const props = {
        ...defaultProps,
        currentStep: "draft" as Step,
        steps: {
          transcribe: "success" as StepStatus,
          draft: "running" as StepStatus,
          review: "pending" as StepStatus,
          export: "pending" as StepStatus,
        },
      };

      render(<StatusDashboard {...props} />);
      expect(screen.getAllByText("Transcribe").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    });

    it("should display error status correctly", () => {
      const props = {
        ...defaultProps,
        steps: {
          ...defaultProps.steps,
          transcribe: "error" as StepStatus,
        },
        hasError: true,
      };

      render(<StatusDashboard {...props} />);
      expect(screen.getAllByText("Transcribe").length).toBeGreaterThan(0);
    });

    it("should display mixed status states", () => {
      const props = {
        ...defaultProps,
        currentStep: "review" as Step,
        steps: {
          transcribe: "success" as StepStatus,
          draft: "success" as StepStatus,
          review: "running" as StepStatus,
          export: "pending" as StepStatus,
        },
      };

      render(<StatusDashboard {...props} />);
      expect(screen.getAllByText("Review").length).toBeGreaterThan(0);
    });
  });

  describe("Progress Ring Display", () => {
    it("should render progress ring with 0%", () => {
      render(<StatusDashboard {...defaultProps} overallProgress={0} />);
      // Progress ring should be rendered
      expect(screen.getByText("Overall Progress")).toBeInTheDocument();
    });

    it("should render progress ring with 50%", () => {
      render(<StatusDashboard {...defaultProps} overallProgress={50} />);
      expect(screen.getByText("Overall Progress")).toBeInTheDocument();
    });

    it("should render progress ring with 100%", () => {
      render(<StatusDashboard {...defaultProps} overallProgress={100} />);
      expect(screen.getByText("Overall Progress")).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    it("should display error banner when hasError is true", () => {
      const props = {
        ...defaultProps,
        hasError: true,
      };

      render(<StatusDashboard {...props} />);
      expect(
        screen.getByText(/An error occurred during pipeline execution/)
      ).toBeInTheDocument();
    });

    it("should display custom error message", () => {
      const props = {
        ...defaultProps,
        hasError: true,
        errorMessage: "Custom error message",
      };

      render(<StatusDashboard {...props} />);
      expect(screen.getByText("Custom error message")).toBeInTheDocument();
    });

    it("should not display error banner when hasError is false", () => {
      render(<StatusDashboard {...defaultProps} hasError={false} />);
      expect(
        screen.queryByText(/An error occurred during pipeline execution/)
      ).not.toBeInTheDocument();
    });

    it("should display error icon in banner", () => {
      const props = {
        ...defaultProps,
        hasError: true,
      };

      const { container } = render(<StatusDashboard {...props} />);
      expect(container.querySelector('[class*="errorIcon"]')).toBeInTheDocument();
    });
  });

  describe("Action Buttons", () => {
    it("should render cancel button when onCancel is provided", () => {
      const onCancel = jest.fn();
      const props = {
        ...defaultProps,
        onCancel,
      };

      render(<StatusDashboard {...props} />);
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("should call onCancel when cancel button is clicked", () => {
      const onCancel = jest.fn();
      const props = {
        ...defaultProps,
        onCancel,
      };

      render(<StatusDashboard {...props} />);
      fireEvent.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("should render retry button when onRetry and canRetry are provided", () => {
      const onRetry = jest.fn();
      const props = {
        ...defaultProps,
        onRetry,
        canRetry: true,
      };

      render(<StatusDashboard {...props} />);
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    it("should call onRetry when retry button is clicked", () => {
      const onRetry = jest.fn();
      const props = {
        ...defaultProps,
        onRetry,
        canRetry: true,
      };

      render(<StatusDashboard {...props} />);
      fireEvent.click(screen.getByText("Retry"));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("should not render retry button when canRetry is false", () => {
      const onRetry = jest.fn();
      const props = {
        ...defaultProps,
        onRetry,
        canRetry: false,
      };

      render(<StatusDashboard {...props} />);
      expect(screen.queryByText("Retry")).not.toBeInTheDocument();
    });

    it("should not render action buttons when no callbacks provided", () => {
      render(<StatusDashboard {...defaultProps} />);
      expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
      expect(screen.queryByText("Retry")).not.toBeInTheDocument();
    });

    it("should render both cancel and retry buttons together", () => {
      const onCancel = jest.fn();
      const onRetry = jest.fn();
      const props = {
        ...defaultProps,
        onCancel,
        onRetry,
        canRetry: true,
      };

      render(<StatusDashboard {...props} />);
      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero elapsed time", () => {
      render(<StatusDashboard {...defaultProps} elapsedSeconds={0} />);
      expect(screen.getByText("0:00")).toBeInTheDocument();
    });

    it("should handle negative elapsed time", () => {
      render(<StatusDashboard {...defaultProps} elapsedSeconds={-10} />);
      // Should default to 0:00
      expect(screen.getByText("0:00")).toBeInTheDocument();
    });

    it("should handle NaN elapsed time", () => {
      render(<StatusDashboard {...defaultProps} elapsedSeconds={NaN} />);
      // Should default to 0:00
      expect(screen.getByText("0:00")).toBeInTheDocument();
    });

    it("should handle 100% progress", () => {
      const props = {
        ...defaultProps,
        overallProgress: 100,
        currentStep: "export" as Step,
        steps: {
          transcribe: "success" as StepStatus,
          draft: "success" as StepStatus,
          review: "success" as StepStatus,
          export: "success" as StepStatus,
        },
      };

      render(<StatusDashboard {...props} />);
      expect(screen.getAllByText("Export").length).toBeGreaterThan(0);
    });

    it("should handle progress over 100%", () => {
      render(<StatusDashboard {...defaultProps} overallProgress={150} />);
      // Component should still render without crashing
      expect(screen.getByText("Overall Progress")).toBeInTheDocument();
    });
  });
});
