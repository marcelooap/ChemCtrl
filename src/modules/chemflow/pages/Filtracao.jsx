import { Filter, Package } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@shared/components/ui/tabs";
import FiltracaoTab from "@chemflow/components/filtracao/FiltracaoTab";
import InsumosTab from "@chemflow/components/filtracao/InsumosTab";

const TAB_TRIGGER_CLASS =
  "gap-2 px-5 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md";

export default function Filtracao() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Filtração</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Controle de filtrações e elementos filtrantes em estoque
        </p>
      </div>

      <Tabs defaultValue="filtracao">
        <TabsList className="h-auto p-1.5 gap-1 bg-muted/80 border border-border shadow-sm">
          <TabsTrigger value="filtracao" className={TAB_TRIGGER_CLASS}>
            <Filter className="w-4 h-4" />
            Filtração
          </TabsTrigger>
          <TabsTrigger value="insumos" className={TAB_TRIGGER_CLASS}>
            <Package className="w-4 h-4" />
            Insumos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="filtracao" className="mt-6">
          <FiltracaoTab />
        </TabsContent>
        <TabsContent value="insumos" className="mt-6">
          <InsumosTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
