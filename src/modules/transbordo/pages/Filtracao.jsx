import { Filter, Package } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@shared/components/ui/tabs";
import FiltracaoTab from "@transbordo/components/filtracao/FiltracaoTab";
import InsumosTab from "@transbordo/components/filtracao/InsumosTab";

const TAB_TRIGGER_CLASS =
  "gap-1.5 px-4 py-2 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md";

export default function Filtracao() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-3">
      <Tabs
        defaultValue="filtracao"
        className="flex flex-1 min-h-0 flex-col overflow-hidden"
      >
        <div className="shrink-0 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground leading-tight">Filtração</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Controle de filtrações e elementos filtrantes em estoque
            </p>
          </div>
          <TabsList className="h-auto p-1 gap-1 bg-muted/80 border border-border shadow-sm w-fit shrink-0">
            <TabsTrigger value="filtracao" className={TAB_TRIGGER_CLASS}>
              <Filter className="w-4 h-4" />
              Filtração
            </TabsTrigger>
            <TabsTrigger value="insumos" className={TAB_TRIGGER_CLASS}>
              <Package className="w-4 h-4" />
              Insumos
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="filtracao"
          className="mt-3 flex flex-1 min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <FiltracaoTab />
        </TabsContent>
        <TabsContent
          value="insumos"
          className="mt-3 flex flex-1 min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <InsumosTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
