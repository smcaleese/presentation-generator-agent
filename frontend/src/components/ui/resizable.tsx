import { GripVertical } from "lucide-react";
import {
  Panel as PrimitivePanel,
  PanelGroup as PrimitivePanelGroup,
  PanelResizeHandle as PrimitivePanelResizeHandle,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof PrimitivePanelGroup>) {
  return (
    <PrimitivePanelGroup
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

const ResizablePanel = PrimitivePanel;

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof PrimitivePanelResizeHandle> & { withHandle?: boolean }) {
  return (
    <PrimitivePanelResizeHandle
      className={cn(
        "relative flex w-px items-center justify-center bg-border transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:outline-none data-[resize-handle-state=drag]:bg-primary/60 after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-3 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-6 w-3 items-center justify-center rounded-sm border bg-border">
          <GripVertical className="size-2.5" />
        </div>
      )}
    </PrimitivePanelResizeHandle>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
