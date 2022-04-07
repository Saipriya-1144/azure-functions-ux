import React, { useContext, useEffect, useRef, useState } from 'react';
import { XTerm } from 'xterm-for-react';
import ContainerAppService from '../../../ApiHelpers/ContainerAppService';
import { PortalContext } from '../../../PortalContext';

export interface ConsoleDataLoaderProps {
  resourceId: string;
  revision?: string;
  replica?: string;
  container?: string;
}

const ConsoleDataLoader: React.FC<ConsoleDataLoaderProps> = props => {
  const portalCommunicator = useContext(PortalContext);

  const ws = useRef<WebSocket>();
  const terminalRef = useRef<XTerm>(null);
  const [revisionReplicaContainer, setRevisionReplicaContainer] = useState<string>();

  useEffect(() => {
    portalCommunicator.loadComplete();
  }, [portalCommunicator]);

  React.useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.terminal.options = { cursorStyle: 'underline', cursorBlink: true };
    }
  }, [terminalRef]);

  React.useEffect(() => {
    if (!!props.resourceId && !!props.revision && !!props.replica && !!props.container) {
      setRevisionReplicaContainer(`/revisions/${props.revision}/replicas/${props.replica}/containers/${props.container}`);
    } else {
      setRevisionReplicaContainer(undefined);
    }
  }, [props.resourceId, props.revision, props.replica, props.container]);

  React.useEffect(() => {
    // The selected container has changed.

    // Clean up the web socket
    if (ws.current) {
      if (ws.current.readyState === ws.current.OPEN) {
        ws.current.close();
      }
      ws.current = undefined;
    }

    // Reset the terminal
    if (terminalRef.current) {
      terminalRef.current.terminal.reset();
      terminalRef.current.terminal.options.disableStdin = true;
    }

    // Connect to the container if one is selected.
    if (!!revisionReplicaContainer) {
      const revisionReplicaContainerBefore = revisionReplicaContainer;
      ContainerAppService.getAuthToken(props.resourceId).then(authTokenResponse => {
        if (revisionReplicaContainerBefore === revisionReplicaContainer) {
          const serverEndpoint = getServerEndpoint(authTokenResponse.data.properties.logStreamEndpoint, '/sh');
          ws.current = new WebSocket(serverEndpoint);

          ws.current.onmessage = async (event: MessageEvent) => {
            if (event.data instanceof Blob) {
              processMessageBlob(event.data);
            } else {
              updateConsoleText(event.data + '\r\n');
            }
          };

          ws.current.onerror = (ev: Event) => {
            // log error appropriately
          };

          if (terminalRef.current) {
            terminalRef.current.terminal.options.disableStdin = false;
          }
        }
      });
    }
  }, [revisionReplicaContainer]);

  const getServerEndpoint = (logStreamEndpoint: string, startUpCommand: string) => {
    const wssReplacedEndpoint = logStreamEndpoint.replace('https://', 'wss://');
    const revisionReplacedEndpoint = wssReplacedEndpoint.replace(
      '/revisions/logstream',
      `${revisionReplicaContainer}/exec${startUpCommand}`
    );
    return revisionReplacedEndpoint;
  };

  const processMessageBlob = async (data: Blob) => {
    const arrayBuffer = await data.arrayBuffer();
    const array = new Uint8Array(arrayBuffer);
    const decoder = new TextDecoder();
    let text = '';

    switch (array[0]) {
      case 0: // forwarded from k8s cluster exec endpoint
        if (array[1] === 1 || array[1] === 2 || array[1] === 3) {
          text = decoder.decode(array.slice(2));
          updateConsoleText(text);
        } else if (array[1] === 4) {
          // terminal resize
        } else {
          throw new Error(`unknown Proxy API exec signal ${array[1]}`);
        }
        break;
      case 1: // info from Proxy API
        text = 'INFO: ' + decoder.decode(array.slice(1)) + '\r\n';
        updateConsoleText(text);
        break;
      case 2: // error from Proxy API
        text = 'ERROR: ' + decoder.decode(array.slice(1)) + '\r\n';
        updateConsoleText(text);
        break;
      default:
        throw new Error(`unknown Proxy API exec signal ${array[0]}`);
    }
  };

  const updateConsoleText = (text: string) => {
    terminalRef.current?.terminal.write(text);
  };

  const onData = (data: string) => {
    sendWsMessage(data);
  };

  const sendWsMessage = (text: string) => {
    if (ws.current && ws.current.readyState === ws.current.OPEN) {
      var encoder = new TextEncoder();
      var arr = encoder.encode(text);
      ws.current.send(new Blob([new Uint8Array([0, 0]), arr]));
    }
  };

  return <XTerm ref={terminalRef} onData={onData} />;
};

export default ConsoleDataLoader;
