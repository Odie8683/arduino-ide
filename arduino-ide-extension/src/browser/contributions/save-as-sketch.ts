import * as remote from '@theia/core/electron-shared/@electron/remote';
import { Dialog } from '@theia/core/lib/browser/dialogs';
import { NavigatableWidget } from '@theia/core/lib/browser/navigatable';
import { Saveable } from '@theia/core/lib/browser/saveable';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable } from '@theia/core/shared/inversify';
import { WorkspaceInput } from '@theia/workspace/lib/browser/workspace-service';
import { StartupTask } from '../../electron-common/startup-task';
import { ArduinoMenus } from '../menu/arduino-menus';
import { CurrentSketch } from '../sketches-service-client-impl';
import { CloudSketchContribution } from './cloud-contribution';
import {
  Command,
  CommandRegistry,
  KeybindingRegistry,
  MenuModelRegistry,
  Sketch,
  URI,
} from './contribution';
import { DeleteSketch } from './delete-sketch';
import {
  RenameCloudSketch,
  RenameCloudSketchParams,
} from './rename-cloud-sketch';

@injectable()
export class SaveAsSketch extends CloudSketchContribution {
  @inject(ApplicationShell)
  private readonly applicationShell: ApplicationShell;
  @inject(WindowService)
  private readonly windowService: WindowService;

  override registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(SaveAsSketch.Commands.SAVE_AS_SKETCH, {
      execute: (args) => this.saveAs(args),
    });
  }

  override registerMenus(registry: MenuModelRegistry): void {
    registry.registerMenuAction(ArduinoMenus.FILE__SKETCH_GROUP, {
      commandId: SaveAsSketch.Commands.SAVE_AS_SKETCH.id,
      label: nls.localizeByDefault('Save As...'),
      order: '7',
    });
  }

  override registerKeybindings(registry: KeybindingRegistry): void {
    registry.registerKeybinding({
      command: SaveAsSketch.Commands.SAVE_AS_SKETCH.id,
      keybinding: 'CtrlCmd+Shift+S',
    });
  }

  /**
   * Resolves `true` if the sketch was successfully saved as something.
   */
  private async saveAs(
    {
      execOnlyIfTemp,
      openAfterMove,
      wipeOriginal,
      markAsRecentlyOpened,
    }: SaveAsSketch.Options = SaveAsSketch.Options.DEFAULT
  ): Promise<boolean> {
    const sketch = await this.sketchServiceClient.currentSketch();
    if (!CurrentSketch.isValid(sketch)) {
      return false;
    }

    let destinationUri: string | undefined;
    const cloudUri = this.createFeatures.cloudUri(sketch);
    if (cloudUri) {
      destinationUri = await this.createCloudCopy({ cloudUri, sketch });
    } else {
      destinationUri = await this.createLocalCopy(sketch, execOnlyIfTemp);
    }
    if (!destinationUri) {
      return false;
    }

    const newWorkspaceUri = await this.sketchesService.copy(sketch, {
      destinationUri,
    });
    if (!newWorkspaceUri) {
      return false;
    }

    await this.saveOntoCopiedSketch(sketch, newWorkspaceUri);
    if (markAsRecentlyOpened) {
      this.sketchesService.markAsRecentlyOpened(newWorkspaceUri);
    }
    const options: WorkspaceInput & StartupTask.Owner = {
      preserveWindow: true,
      tasks: [],
    };
    if (openAfterMove) {
      this.windowService.setSafeToShutDown();
      if (wipeOriginal || (openAfterMove && execOnlyIfTemp)) {
        options.tasks.push({
          command: DeleteSketch.Commands.DELETE_SKETCH.id,
          args: [{ toDelete: sketch.uri }],
        });
      }
      this.workspaceService.open(new URI(newWorkspaceUri), options);
    }
    return !!newWorkspaceUri;
  }

  private async createCloudCopy(
    params: RenameCloudSketchParams
  ): Promise<string | undefined> {
    return this.commandService.executeCommand<string>(
      RenameCloudSketch.Commands.RENAME_CLOUD_SKETCH.id,
      params
    );
  }

  private async createLocalCopy(
    sketch: Sketch,
    execOnlyIfTemp?: boolean
  ): Promise<string | undefined> {
    const isTemp = await this.sketchesService.isTemp(sketch);
    if (!isTemp && !!execOnlyIfTemp) {
      return undefined;
    }

    const sketchUri = new URI(sketch.uri);
    const sketchbookDirUri = await this.defaultUri();
    // If the sketch is temp, IDE2 proposes the default sketchbook folder URI.
    // If the sketch is not temp, but not contained in the default sketchbook folder, IDE2 proposes the default location.
    // Otherwise, it proposes the parent folder of the current sketch.
    const containerDirUri = isTemp
      ? sketchbookDirUri
      : !sketchbookDirUri.isEqualOrParent(sketchUri)
      ? sketchbookDirUri
      : sketchUri.parent;
    const exists = await this.fileService.exists(
      containerDirUri.resolve(sketch.name)
    );

    // If target does not exist, propose a `directories.user`/${sketch.name} path
    // If target exists, propose `directories.user`/${sketch.name}_copy_${yyyymmddHHMMss}
    // IDE2 must never prompt an invalid sketch folder name (https://github.com/arduino/arduino-ide/pull/1833#issuecomment-1412569252)
    const defaultUri = containerDirUri.resolve(
      Sketch.toValidSketchFolderName(sketch.name, exists)
    );
    const defaultPath = await this.fileService.fsPath(defaultUri);
    return await this.promptLocalSketchFolderDestination(defaultPath);
  }

  /**
   * Prompts for the new sketch folder name until a valid one is give,
   * then resolves with the destination sketch folder URI string,
   * or `undefined` if the operation was canceled.
   */
  private async promptLocalSketchFolderDestination(
    defaultPath: string
  ): Promise<string | undefined> {
    let sketchFolderDestinationUri: string | undefined;
    while (!sketchFolderDestinationUri) {
      const { filePath } = await remote.dialog.showSaveDialog(
        remote.getCurrentWindow(),
        {
          title: nls.localize(
            'arduino/sketch/saveFolderAs',
            'Save sketch folder as...'
          ),
          defaultPath,
        }
      );
      if (!filePath) {
        return undefined;
      }
      const destinationUri = await this.fileSystemExt.getUri(filePath);
      const sketchFolderName = new URI(destinationUri).path.base;
      const errorMessage = Sketch.validateSketchFolderName(sketchFolderName);
      if (errorMessage) {
        const message = `
${nls.localize(
  'arduino/sketch/invalidSketchFolderNameTitle',
  "Invalid sketch folder name: '{0}'",
  sketchFolderName
)}

${errorMessage}

${nls.localize(
  'arduino/sketch/editInvalidSketchFolderName',
  'Do you want to try to save the sketch folder with a different name?'
)}`.trim();
        defaultPath = filePath;
        const { response } = await remote.dialog.showMessageBox(
          remote.getCurrentWindow(),
          {
            message,
            buttons: [Dialog.CANCEL, Dialog.YES],
          }
        );
        // cancel
        if (response === 0) {
          return undefined;
        }
      } else {
        sketchFolderDestinationUri = destinationUri;
      }
    }
    return sketchFolderDestinationUri;
  }

  private async saveOntoCopiedSketch(
    sketch: Sketch,
    newSketchFolderUri: string
  ): Promise<void> {
    const widgets = this.applicationShell.widgets;
    const snapshots = new Map<string, Saveable.Snapshot>();
    for (const widget of widgets) {
      const saveable = Saveable.getDirty(widget);
      const uri = NavigatableWidget.getUri(widget);
      if (!uri) {
        continue;
      }
      const uriString = uri.toString();
      let relativePath: string;
      if (
        uriString.includes(sketch.uri) &&
        saveable &&
        saveable.createSnapshot
      ) {
        // The main file will change its name during the copy process
        // We need to store the new name in the map
        if (sketch.mainFileUri === uriString) {
          const lastPart = new URI(newSketchFolderUri).path.base + uri.path.ext;
          relativePath = '/' + lastPart;
        } else {
          relativePath = uri.toString().substring(sketch.uri.length);
        }
        snapshots.set(relativePath, saveable.createSnapshot());
      }
    }
    await Promise.all(
      Array.from(snapshots.entries()).map(async ([path, snapshot]) => {
        const widgetUri = new URI(newSketchFolderUri + path);
        try {
          const widget = await this.editorManager.getOrCreateByUri(widgetUri);
          const saveable = Saveable.get(widget);
          if (saveable && saveable.applySnapshot) {
            saveable.applySnapshot(snapshot);
            await saveable.save();
          }
        } catch (e) {
          console.error(e);
        }
      })
    );
  }
}

export namespace SaveAsSketch {
  export namespace Commands {
    export const SAVE_AS_SKETCH: Command = {
      id: 'arduino-save-as-sketch',
    };
  }
  export interface Options {
    readonly execOnlyIfTemp?: boolean;
    readonly openAfterMove?: boolean;
    /**
     * Ignored if `openAfterMove` is `false`.
     */
    readonly wipeOriginal?: boolean;
    readonly markAsRecentlyOpened?: boolean;
  }
  export namespace Options {
    export const DEFAULT: Options = {
      execOnlyIfTemp: false,
      openAfterMove: true,
      wipeOriginal: false,
      markAsRecentlyOpened: false,
    };
  }
}
