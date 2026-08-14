import { Package, Cylinder, Container } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@shared/components/ui/tabs";
import ProdutosTab from "@transbordo/components/cadastro/ProdutosTab";
import IsotanquesTab from "@transbordo/components/cadastro/IsotanquesTab";
import VasilhamesTab from "@transbordo/components/cadastro/VasilhamesTab";

const TAB_TRIGGER_CLASS =
  "gap-1.5 px-4 py-2 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md";

export default function Cadastro() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-3">
      <Tabs defaultValue="produto" className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <div className="shrink-0 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground leading-tight">Cadastros</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Gerencie produtos, isotanques e vasilhames cadastrados no sistema
            </p>
          </div>
          <TabsList className="h-auto p-1 gap-1 bg-muted/80 border border-border shadow-sm w-fit shrink-0">
            <TabsTrigger value="produto" className={TAB_TRIGGER_CLASS}>
              <Package className="w-4 h-4" />
              Produto
            </TabsTrigger>
            <TabsTrigger value="isotanque" className={TAB_TRIGGER_CLASS}>
              <Cylinder className="w-4 h-4" />
              Isotanque
            </TabsTrigger>
            <TabsTrigger value="vasilhame" className={TAB_TRIGGER_CLASS}>
              <Container className="w-4 h-4" />
              Vasilhame
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="produto"
          className="mt-3 flex flex-1 min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <ProdutosTab />
        </TabsContent>
        <TabsContent
          value="isotanque"
          className="mt-3 flex flex-1 min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <IsotanquesTab />
        </TabsContent>
        <TabsContent
          value="vasilhame"
          className="mt-3 flex flex-1 min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <VasilhamesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
