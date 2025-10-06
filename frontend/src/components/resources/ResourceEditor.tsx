import { useRef, useState, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { Save, ArrowBigLeft, Shredder, Plus, Minus, Pencil, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getLocalBoolean } from '@/lib/localStorage';
import * as monaco from 'monaco-editor';
import YamlWorker from '@/yaml.worker.js?worker';
import { configureMonacoYaml, MonacoYamlOptions } from 'monaco-yaml';
import { loader } from '@monaco-editor/react';
import { toast } from 'sonner';
import { call } from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import yaml from 'js-yaml';
import { useTheme } from '@/components/ThemeProvider';
import {
  Fonts,
  FONT_KEY,
  EDITOR_FONT_SIZE_KEY,
  EDITOR_FONT_SIZE,
  MANAGED_FIELDS,
  JSONSCHEMA_KEY,
} from '@/settings';
import { useLoaderData } from 'react-router';
import { useVersionState } from '@/store/version';

window.MonacoEnvironment = {
  getWorker(moduleId, label) {
    switch (label) {
      // Handle other cases
      case 'yaml':
        return new YamlWorker();
      default:
        throw new Error(`Unknown label ${label}`);
    }
  },
};

loader.config({ monaco });

export default function ResourceEditor() {
  const { theme } = useTheme();
  const version = useVersionState();
  let navigate = useNavigate();
  const { name, namespace, data } = useLoaderData();
  const [jsonSchema] = useState<boolean>(() => {
    return getLocalBoolean(JSONSCHEMA_KEY);
  });
  const [fontSize, setFontsize] = useState<number>(() => {
    return (
      parseInt(localStorage.getItem(EDITOR_FONT_SIZE_KEY) || EDITOR_FONT_SIZE.toString()) ||
      EDITOR_FONT_SIZE
    );
  });
  const [hasErrors] = useState(false);
  const [minimap, setMinimap] = useState(true);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [original, setOriginal] = useState(() => {
    if (getLocalBoolean(MANAGED_FIELDS)) {
      let obj = yaml.load(data);
      if (obj?.metadata?.managedFields) {
        delete obj.metadata.managedFields;
      }
      const cleanedYaml = yaml.dump(obj);
      return cleanedYaml;
    } else {
      return data;
    }
  });
  const [stripManagedFields, setStripManagedFields] = useState(false);
  const [selectedFont] = useState<string>(() => {
    return (
      Fonts.find((f) => f.className === localStorage.getItem(FONT_KEY))?.label || 'Cascadia Code'
    );
  });

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    let monacoParams: MonacoYamlOptions = { enableSchemaRequest: false };
    let obj = yaml.load(data);
    if (jsonSchema) {
      const k8sv = version.version.get().split('+')[0];
      const file = `file:///yaml/${obj.kind}/**`;
      monacoParams = {
        enableSchemaRequest: true,
        schemas: [
          {
            fileMatch: [file],
            uri: `https://raw.githubusercontent.com/yannh/kubernetes-json-schema/refs/heads/master/${k8sv}/${obj.kind.toLowerCase()}.json`,
          },
        ],
      };
    }
    configureMonacoYaml(monacoInstance, monacoParams);
    editorRef.current = editor;
    editor.focus();
  };

  const changeFont = async (size: number) => {
    if (size < 0 && fontSize >= 5) {
      setFontsize(fontSize - 1);
      localStorage.setItem(EDITOR_FONT_SIZE_KEY, (fontSize - 1).toString());
    } else if (size > 0 && fontSize <= 40) {
      setFontsize(fontSize + 1);
      localStorage.setItem(EDITOR_FONT_SIZE_KEY, (fontSize + 1).toString());
    }
  };

  const onSave = async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor?.getModel();
    const markers = monaco?.editor.getModelMarkers({ resource: model?.uri });

    if (markers && markers.length > 0) {
      toast.error(
        <div className="flex flex-col">
          <div>YAML has validation errors. Please fix them before saving.</div>
          {markers.map((m, i: number) => (
            <div key={i} className="font-bold">
              {m.message}
            </div>
          ))}
        </div>,
      );
      return;
    }

    const value = editorRef.current?.getValue();
    let obj = yaml.load(value);
    if (obj?.metadata?.managedFields) {
      delete obj.metadata.managedFields;
    }
    const cleanedYaml = yaml.dump(obj);
    const response = await call('update_kube_resource', {
      namespace: obj.metadata.namespace,
      yaml: cleanedYaml,
    });
    if (response.message) {
      toast.error(<span>Cant update resource: {response.message}</span>);
      return;
    }
    toast.info(
      <span>
        Resource updated:
        <br />
        <span className="font-bold text-muted-foreground">
          {obj.kind} {obj.metadata.namespace ? `${obj.metadata.namespace}/` : ''}
          {obj.metadata.name}
        </span>
      </span>,
    );
    setOriginal(cleanedYaml!);
  };

  const handleToggle = () => {
    setStripManagedFields(stripManagedFields);

    try {
      const editor = editorRef.current;
      if (!editor) return;

      const raw = editor.getValue();
      const obj = yaml.load(raw) as any;

      if (obj?.metadata?.managedFields) {
        delete obj.metadata.managedFields;
        const newYaml = yaml.dump(obj);
        editor.setValue(newYaml);
      }
    } catch (err) {
      toast.error('Invalid YAML');
      console.error(err);
    }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        navigate(-1);
      }
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onSave();
      }
      if (e.key === '-' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setFontsize(fontSize - 1);
      }
      if (e.key === '=' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setFontsize(fontSize + 1);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <div className="h-screen flex flex-col">
      <div className="flex gap-2 px-2 py-2 border-b justify-items-stretch items-center">
        <Button title="back" className="text-xs bg-blue-500" onClick={() => navigate(-1)}>
          <ArrowBigLeft /> Esc
        </Button>
        <Button title="save" className="text-xs bg-green-500" disabled={hasErrors} onClick={onSave}>
          <Save /> Update
        </Button>
        {getLocalBoolean(MANAGED_FIELDS) ? (
          <></>
        ) : (
          <Button
            title="strip managedFields"
            className="text-xs bg-orange-500"
            disabled={hasErrors}
            onClick={handleToggle}
          >
            <Shredder />
          </Button>
        )}
        <Button
          title="toggle minimap"
          className="text-xs bg-gray-500"
          onClick={() => setMinimap(!minimap)}
        >
          <Map />
        </Button>
        <Button
          title="decrease font"
          className="text-xs bg-gray-500"
          onClick={() => changeFont(-1)}
        >
          <Minus />
        </Button>
        <Button title="increase font" className="text-xs bg-gray-500" onClick={() => changeFont(1)}>
          <Plus />
        </Button>
        <div className="flex flex-row items-center text-xs">
          <Pencil className="mr-1" size={14} />
          {namespace && namespace !== 'undefined' ? `${namespace}/${name}` : name}
        </div>
      </div>
      <Editor
        height="90vh"
        defaultLanguage="yaml"
        path={location.pathname}
        options={{
          minimap: { enabled: minimap },
          fontFamily: selectedFont,
          fontSize: fontSize,
          automaticLayout: true,
        }}
        onChange={(value) => setOriginal(value || '')}
        value={original}
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        onMount={handleEditorMount}
      />
    </div>
  );
}
