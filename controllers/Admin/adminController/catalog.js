// Admin controller — catalog.
// Split out of AdminController.js (Nov 2026) — code moved unchanged; only
// require paths are one folder deeper. AdminController.js re-exports everything.
const {
  Service,
  response,
  ApiResponse,
  Category,
  SubCategory,
  Op,
} = require("./_shared");

async function add_service(req, res) {
  const { title, desc } = req.body;
  const check = await Service.findOne({ where: [{ title: title }] });
  if (check) {
    const response = ApiResponse("0", "Service Already exist", {});
    return res.json(response);
  } else {
    const service = new Service();
    service.title = title;
    service.desc = desc;
    service.status = 1;
    service
      .save()
      .then((dat) => {
        const response = ApiResponse("1", "Service added successfully!", {});
        return res.json(response);
      })
      .catch((error) => {
        const response = ApiResponse("0", "Something went wrong", {});
        return res.json(response);
      });
  }
}

async function get_all_services(req, res) {
  const services = await Service.findAll({});
  const response = ApiResponse("1", "All Services", services);
  return res.json(response);
}

async function activate_service(req, res) {
  const service = await Service.findOne({ where: { id: req.body.serviceId } });

  if (service) {
    service.status = true;
    service
      .save()
      .then((dat) => {
        const response = ApiResponse("1", "Activated successfully!", {});
        return res.json(response);
      })
      .catch((error) => {
        const response = ApiResponse("0", "Something went wrong!", {});
        return res.json(response);
      });
  } else {
    const response = ApiResponse("0", "Something went wrong!", {});
    return res.json(response);
  }
}

async function block_service(req, res) {
  const service = await Service.findOne({ where: { id: req.body.serviceId } });
  if (service) {
    service.status = false;
    service
      .save()
      .then((dat) => {
        const response = ApiResponse("1", "Blocked successfully!", {});
        return res.json(response);
      })
      .catch((error) => {
        const response = ApiResponse("0", "Something went wrong!", {});
        return res.json(response);
      });
  } else {
    const response = ApiResponse("0", "Something went wrong!", {});
    return res.json(response);
  }
}

async function update_service(req, res) {
  const service = await Service.findOne({ where: { id: req.body.id } });
  service.title = req.body.title;
  service.desc = req.body.desc;
  service
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "Service updated", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", "Something went wrong", {});
      return res.json(response);
    });
}

async function add_category(req, res) {
  const { title } = req.body;
  const check = await Category.findOne({ where: { title: title } });
  if (check) {
    const response = ApiResponse("0", "Already exists", {});
    return res.json(response);
  } else {
    const category = new Category();
    category.title = title;
    category.status = 1;
    category.save().then((dat) => {
      const response = ApiResponse("1", "Category added successfully!", {});
      return res.json(response);
    });
  }
}

async function all_categories(req, res) {
  const categories = await Category.findAll({ attributes: ["id", "title"] });
  const response = ApiResponse("1", "All Categories", {
    categories: categories,
  });
  return res.json(response);
}

async function get_subcategories(req, res) {
  const { categoryId } = req.params;
  let data = await SubCategory.findAll({
    where: { CategoryId: categoryId },
    attributes: ["id", "title"],
  });
  let response = ApiResponse("1", "Sub Categories", { data });
  return res.json(response);
}

async function udpate_category(req, res) {
  const category = await Category.findByPk(req.body.id);
  category.title = req.body.title;
  category
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "Updated successfully!", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", "Somehting went wrong", {});
      return res.json(response);
    });
}

async function get_subcategories_based_on_user_types(req, res) {
  var { userType } = req.params;
  if (userType === process.env.DIETITION) {
    userType = "Diet";
  }
  if (userType === process.env.TRAINER) {
    userType = "Workout";
  }
  if (userType === process.env.GYNECOLOGIST) {
    userType = "Gynaecologist";
  }

  try {
    // Fetch subcategories where the title of the associated category matches the userType using LIKE
    let data = await SubCategory.findAll({
      where: { status: true },
      attributes: ["id", "title"],
      include: {
        model: Category,
        attributes: [],
        where: {
          title: {
            [Op.like]: `%${userType}%`, // Searching for title similar to userType
          },
        },
      },
    });

    // Creating a response with a custom API response function
    let response = ApiResponse("1", "Data", { data });
    return res.json(response);
  } catch (error) {
    // Handle errors and send an appropriate response
    let response = ApiResponse("0", "Error", { error: error.message });
    return res.status(500).json(response);
  }
}

module.exports = {
  add_service,
  get_all_services,
  activate_service,
  update_service,
  block_service,
  add_category,
  all_categories,
  udpate_category,
  get_subcategories,
  get_subcategories_based_on_user_types,
};
