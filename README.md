# IFB_scheduling_system

## Start the portal

In VS Code, open this workspace and allow the **Start IFB scheduling server**
automatic task when prompted. It starts the backend on port 3001 whenever the
workspace is opened. The portal is available at http://localhost:3001.

To use the Live Server extension, open `frontend/index.html` and select **Go
Live**. The workspace settings serve the `frontend` folder on port 5500, and
the frontend sends API requests to the backend on port 3001. Live Server only
serves the frontend; the backend automatic task must also be running.

If automatic tasks are disabled, run **Tasks: Manage Automatic Tasks in
Folder** from the Command Palette and allow them for this workspace.
