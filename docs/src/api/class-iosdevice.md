# class: IOSDevice
* since: v1.52
* langs: js

[IOSDevice] represents a launched iOS Simulator. Devices can be obtained using [`method: IOS.devices`].


## async method: IOSDevice.launch
* since: 1.52

### param: IOSDevice.launch.app
* since: 1.52
- `app` <string>

## async method: IOSDevice.pressButton
* since: 1.52

### param: IOSDevice.pressButton.button
* since: 1.52
- `button` <'home'|'lock'>

## async method: IOSDevice.screenshot
* since: v1.52
- returns: <[Buffer]>

Returns the buffer with the captured screenshot of the device.

### option: IOSDevice.screenshot.path
* since: v1.9
- `path` <[path]>

The file path to save the image to. If [`option: path`] is a
relative path, then it is resolved relative to the current working directory. If no path is provided, the image won't be
saved to the disk.
