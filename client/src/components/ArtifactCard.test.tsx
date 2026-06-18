// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ArtifactCard from "./ArtifactCard";

const ARTIFACT = {
  filename: "x.md",
  format: "md" as const,
  content: "# Hi\n\nBody text.",
};
const DOWNLOAD_URL = "/workspaces/1/agent/boards/2/artifact/download";

afterEach(cleanup);

describe("ArtifactCard", () => {
  it("renders the filename, the Document · MD meta, and a Download control", () => {
    render(<ArtifactCard artifact={ARTIFACT} downloadUrl={DOWNLOAD_URL} />);
    expect(screen.getByText("x.md")).toBeTruthy();
    expect(screen.getByText(/Document · MD/i)).toBeTruthy();
    expect(screen.getByText(/download/i)).toBeTruthy();
  });

  it("points the Download control at the artifact download URL", () => {
    const { container } = render(
      <ArtifactCard artifact={ARTIFACT} downloadUrl={DOWNLOAD_URL} />,
    );
    const link = container.querySelector(`a[href="${DOWNLOAD_URL}"]`);
    expect(link).toBeTruthy();
  });

  it("opens a full-screen markdown modal rendering the document on card click", () => {
    render(<ArtifactCard artifact={ARTIFACT} downloadUrl={DOWNLOAD_URL} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("x.md"));
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("Hi");
  });

  it("closes the modal when the close control is clicked", () => {
    render(<ArtifactCard artifact={ARTIFACT} downloadUrl={DOWNLOAD_URL} />);
    fireEvent.click(screen.getByText("x.md"));
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
