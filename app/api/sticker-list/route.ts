import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isReadOnlyUser } from "@/lib/userAccess";

type StickerCategoryType = "car" | "general" | "custom";

type StickerListPayload = {
  id?: string;
  category_type?: StickerCategoryType;
  car_id?: number | null;
  custom_category?: string | null;
  sticker_text?: string;
  quantity?: number;
  notes?: string | null;
  done?: boolean;
  created_by?: string | null;
};

function getRequestUserEmail(request: NextRequest) {
  return request.cookies.get("user-email")?.value?.trim().toLowerCase() ?? "";
}

function blockReadOnlyUser(request: NextRequest) {
  const userEmail = getRequestUserEmail(request);

  if (isReadOnlyUser(userEmail)) {
    return NextResponse.json(
      { error: "Guest mode is view-only. Sticker list changes are disabled." },
      { status: 403 },
    );
  }

  return null;
}

function cleanStickerPayload(payload: StickerListPayload) {
  const categoryType = payload.category_type || "general";

  if (!["car", "general", "custom"].includes(categoryType)) {
    throw new Error("Invalid sticker category.");
  }

  const stickerText = payload.sticker_text?.trim();

  if (!stickerText) {
    throw new Error("Sticker text is required.");
  }

  if (categoryType === "car" && !payload.car_id) {
    throw new Error("Car category requires a car ID.");
  }

  if (categoryType === "custom" && !payload.custom_category?.trim()) {
    throw new Error("Custom category requires a category name.");
  }

  const quantity = Number(payload.quantity ?? 1);

  return {
    category_type: categoryType,
    car_id: categoryType === "car" ? Number(payload.car_id) : null,
    custom_category:
      categoryType === "custom" ? payload.custom_category?.trim() : null,
    sticker_text: stickerText,
    quantity: Number.isFinite(quantity) ? Math.max(1, Math.round(quantity)) : 1,
    notes: payload.notes?.trim() || null,
    done: Boolean(payload.done ?? false),
    created_by: payload.created_by?.trim() || null,
    updated_at: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("sticker_list_items")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load sticker list.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const readOnlyBlock = blockReadOnlyUser(request);

  if (readOnlyBlock) {
    return readOnlyBlock;
  }

  try {
    const payload = (await request.json()) as StickerListPayload;
    const cleanPayload = cleanStickerPayload(payload);

    const { data, error } = await supabase
      .from("sticker_list_items")
      .insert(cleanPayload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to add sticker item.",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const readOnlyBlock = blockReadOnlyUser(request);

  if (readOnlyBlock) {
    return readOnlyBlock;
  }

  try {
    const payload = (await request.json()) as StickerListPayload;

    if (!payload.id) {
      return NextResponse.json(
        { error: "Sticker item ID is required." },
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (payload.category_type !== undefined) {
      if (!["car", "general", "custom"].includes(payload.category_type)) {
        return NextResponse.json(
          { error: "Invalid sticker category." },
          { status: 400 },
        );
      }

      updates.category_type = payload.category_type;
      updates.car_id =
        payload.category_type === "car" ? Number(payload.car_id) : null;
      updates.custom_category =
        payload.category_type === "custom"
          ? payload.custom_category?.trim() || null
          : null;
    }

    if (payload.sticker_text !== undefined) {
      const stickerText = payload.sticker_text.trim();

      if (!stickerText) {
        return NextResponse.json(
          { error: "Sticker text cannot be empty." },
          { status: 400 },
        );
      }

      updates.sticker_text = stickerText;
    }

    if (payload.quantity !== undefined) {
      const quantity = Number(payload.quantity);
      updates.quantity = Number.isFinite(quantity)
        ? Math.max(1, Math.round(quantity))
        : 1;
    }

    if (payload.notes !== undefined) {
      updates.notes = payload.notes?.trim() || null;
    }

    if (payload.done !== undefined) {
      updates.done = Boolean(payload.done);
    }

    const { data, error } = await supabase
      .from("sticker_list_items")
      .update(updates)
      .eq("id", payload.id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update sticker item.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const readOnlyBlock = blockReadOnlyUser(request);

  if (readOnlyBlock) {
    return readOnlyBlock;
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Sticker item ID is required." },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("sticker_list_items")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete sticker item.",
      },
      { status: 500 },
    );
  }
}